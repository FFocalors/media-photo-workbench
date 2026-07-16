import { spawn } from "child_process";
import crypto from "crypto";
import os from "os";
import path from "path";
import fs from "fs-extra";
import { safeLog } from "./logger";
import { getCurrentOperationId } from "./operationContext";

export interface PowerShellJsonOptions {
  timeoutMs?: number;
  elevated?: boolean;
}

export interface PowerShellJsonDiagnostics {
  operationId?: string;
  parentOperationId?: string;
  operation?: string;
  scriptName?: string;
  stage?: string;
  code?: string;
  message?: string;
  technicalMessage?: string;
  exceptionType?: string;
  command?: string;
  siteName?: string;
  rollbackAttempted?: boolean;
  rollbackSucceeded?: boolean | null;
  warnings?: unknown[];
  timestamp?: string;
  exitCode?: number;
  details?: Record<string, unknown>;
  data?: unknown;
  systemStateUnknown?: boolean;
}

export interface PowerShellJsonEnvelope<T> extends PowerShellJsonDiagnostics {
  ok?: boolean;
  action?: string;
  data?: T;
  error?: {
    code?: string;
    message?: string;
    technicalMessage?: string;
    exceptionType?: string;
    command?: string;
    details?: Record<string, unknown>;
  } | null;
}

interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface OperationFiles {
  operationId: string;
  parentOperationId?: string;
  operationDir: string;
  inputPath: string;
  outputPath: string;
  statusPath: string;
}

interface StatusFile {
  operationId?: string;
  operation?: string;
  stage?: string;
  processId?: number;
  exitCode?: number;
  timestamp?: string;
  code?: string;
  message?: string;
}

export type PowerShellServiceError = Error & {
  code: string;
  diagnostics?: PowerShellJsonDiagnostics;
};

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_CAPTURE_LENGTH = 1024 * 1024;
const MAX_DIAGNOSTIC_PREVIEW_LENGTH = 4096;
const APP_TEMP_FOLDER = "MediaPhotoWorkbench";
const STALE_OPERATION_AGE_MS = 15 * 60 * 1000;
const ACTIVE_OPERATION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const CLEANUP_RETRY_DELAYS_MS = [10_000, 30_000, 120_000, 600_000];
const STABLE_FILE_INTERVAL_MS = 60;
const STABLE_FILE_READS = 5;

let elevatedQueue: Promise<void> = Promise.resolve();
let uncertainElevatedOperation: OperationFiles | null = null;

function getUncertainElevatedOperation(): OperationFiles | null {
  return uncertainElevatedOperation;
}

function createServiceError(
  code: string,
  message: string,
  diagnostics?: PowerShellJsonDiagnostics
): PowerShellServiceError {
  return Object.assign(new Error(message), { code, ...(diagnostics ? { diagnostics } : {}) });
}

function assertWindows(): void {
  if (process.platform !== "win32") {
    throw createServiceError("UNSUPPORTED_PLATFORM", "Windows IIS FTP 仅支持 Windows 11。当前系统不受支持。");
  }
}

function assertScriptName(scriptName: string): void {
  if (!/^[a-z0-9][a-z0-9._-]*\.ps1$/i.test(scriptName)) {
    throw createServiceError("IIS_CONFIG_FAILED", "PowerShell 脚本名称无效。");
  }
}

export function resolveWindowsScriptPath(scriptName: string): string {
  assertScriptName(scriptName);
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const resourceRoot = typeof resourcesPath === "string" ? resourcesPath : "";
  const electronProcess = process as NodeJS.Process & { defaultApp?: boolean };
  const isPackagedElectron = Boolean(process.versions.electron && electronProcess.defaultApp !== true);
  const candidates = isPackagedElectron
    ? [resourceRoot ? path.join(resourceRoot, "scripts", "windows", scriptName) : ""]
    : [
        process.env.MPW_WINDOWS_SCRIPTS_DIR
          ? path.join(process.env.MPW_WINDOWS_SCRIPTS_DIR, scriptName)
          : "",
        resourceRoot ? path.join(resourceRoot, "scripts", "windows", scriptName) : "",
        path.resolve(process.cwd(), "scripts", "windows", scriptName),
        path.resolve(__dirname, "../../scripts/windows", scriptName)
      ];

  const resolved = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!resolved) {
    throw createServiceError("IIS_SCRIPT_NOT_FOUND", `缺少 IIS FTP 管理脚本：${scriptName}`);
  }
  return path.resolve(resolved);
}

function runProcess(command: string, args: string[], timeoutMs: number): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(createServiceError("ELEVATED_SCRIPT_TIMEOUT", "IIS FTP 管理操作等待超时。"));
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      if (stdout.length < MAX_CAPTURE_LENGTH) stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      if (stderr.length < MAX_CAPTURE_LENGTH) stderr += String(chunk);
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}

async function applyStrictWindowsAcl(targetPath: string): Promise<void> {
  await fs.chmod(targetPath, 0o700);
  if (process.platform !== "win32") return;

  const username = process.env.USERNAME;
  if (!username) {
    throw createServiceError("TEMP_ACL_FAILED", "无法确定当前 Windows 用户，未创建提权临时文件。");
  }
  const identity = process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${username}` : username;
  const result = await runProcess(
    "icacls.exe",
    [
      targetPath,
      "/inheritance:r",
      "/grant:r",
      `${identity}:(OI)(CI)F`,
      "*S-1-5-32-544:(OI)(CI)F",
      "*S-1-5-18:(OI)(CI)F"
    ],
    15_000
  );
  if (result.exitCode !== 0) {
    throw createServiceError("TEMP_ACL_FAILED", "无法保护提权操作的临时目录。");
  }
}

export function powershellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function windowsPowerShellExecutable(): string {
  const systemRoot = process.env.SystemRoot || "C:\\Windows";
  return path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function operationName(input: unknown): string {
  if (!input || typeof input !== "object") return "unknown";
  const action = (input as Record<string, unknown>).action;
  return typeof action === "string" && action ? action : "unknown";
}

async function writeStatus(statusPath: string, value: StatusFile): Promise<void> {
  await fs.writeFile(statusPath, JSON.stringify({ ...value, timestamp: new Date().toISOString() }), {
    encoding: "utf8",
    mode: 0o600
  });
}

async function createOperationFiles(input: unknown): Promise<OperationFiles> {
  const operationId = crypto.randomUUID();
  const parentOperationId = getCurrentOperationId();
  const operationDir = path.join(os.tmpdir(), APP_TEMP_FOLDER, "elevated", operationId);
  try {
    await fs.ensureDir(operationDir);
    await applyStrictWindowsAcl(operationDir);
    const inputPath = path.join(operationDir, `${crypto.randomUUID()}.input.json`);
    const outputPath = path.join(operationDir, `${crypto.randomUUID()}.output.json`);
    const statusPath = path.join(operationDir, `${crypto.randomUUID()}.status.json`);
    await fs.writeFile(inputPath, JSON.stringify(input), { encoding: "utf8", mode: 0o600 });
    await writeStatus(statusPath, {
      operationId,
      operation: operationName(input),
      stage: "request_created"
    });
    return { operationId, parentOperationId, operationDir, inputPath, outputPath, statusPath };
  } catch (error) {
    await fs.remove(operationDir).catch(() => undefined);
    throw error;
  }
}

async function cleanupOperationDir(operationDir: string): Promise<void> {
  if (await fs.remove(operationDir).then(() => true).catch(() => false)) return;
  for (const delay of CLEANUP_RETRY_DELAYS_MS) {
    const timer = setTimeout(() => {
      void fs.remove(operationDir).catch(() => undefined);
    }, delay);
    timer.unref?.();
  }
}

export async function cleanupStaleElevatedOperationDirs(now = Date.now()): Promise<void> {
  const root = path.join(os.tmpdir(), APP_TEMP_FOLDER, "elevated");
  let entries: fs.Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const directory = path.join(root, entry.name);
    try {
      const stat = await fs.stat(directory);
      const ageMs = now - stat.mtimeMs;
      if (ageMs < STALE_OPERATION_AGE_MS) return;
      const statusEntry = (await fs.readdir(directory)).find((name) => name.endsWith(".status.json"));
      const status = statusEntry ? await readStatusFile(path.join(directory, statusEntry)) : null;
      const mayStillBeRunning = ["uac_accepted", "process_starting", "process_started"].includes(status?.stage || "");
      if (mayStillBeRunning && ageMs < ACTIVE_OPERATION_MAX_AGE_MS) return;
      await fs.remove(directory);
    } catch {
      // Best effort only; never inspect or log secret-bearing input contents.
    }
  }));
}

void cleanupStaleElevatedOperationDirs().catch(() => undefined);

function envelopeDiagnostics<T>(envelope: PowerShellJsonEnvelope<T>): PowerShellJsonDiagnostics {
  return {
    operation: envelope.operation || envelope.action,
    stage: envelope.stage,
    code: envelope.code || envelope.error?.code,
    message: envelope.message || envelope.error?.message,
    technicalMessage: envelope.technicalMessage || envelope.error?.technicalMessage,
    exceptionType: envelope.exceptionType || envelope.error?.exceptionType,
    command: envelope.command || envelope.error?.command,
    siteName: envelope.siteName,
    rollbackAttempted: envelope.rollbackAttempted,
    rollbackSucceeded: envelope.rollbackSucceeded,
    warnings: envelope.warnings,
    timestamp: envelope.timestamp,
    details: envelope.error?.details,
    // Failed provisioning operations still return a sanitized transaction
    // payload containing completed steps, the authoritative preflight and the
    // plan used for rollback reporting. Keep it attached to the error instead
    // of collapsing the failure to an exit code and one message.
    data: envelope.data
  };
}

export function parsePowerShellJsonEnvelope<T>(raw: unknown): T {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw createServiceError("ELEVATED_RESULT_INVALID_SCHEMA", "IIS FTP 管理脚本返回结果缺少必要字段。", {
      stage: "parse_result",
      details: { invalidFields: ["envelope"] }
    });
  }
  const envelope = raw as PowerShellJsonEnvelope<T>;
  const invalidFields: string[] = [];
  if (typeof envelope.ok !== "boolean") invalidFields.push("ok");
  if (typeof (envelope.operation || envelope.action) !== "string" || !(envelope.operation || envelope.action)) {
    invalidFields.push("operation");
  }
  if (typeof envelope.stage !== "string" || !envelope.stage) invalidFields.push("stage");
  if (typeof envelope.timestamp !== "string" || !envelope.timestamp) invalidFields.push("timestamp");
  if (!Object.prototype.hasOwnProperty.call(envelope, "data")) invalidFields.push("data");
  if (envelope.ok === false) {
    if (typeof (envelope.code || envelope.error?.code) !== "string" || !(envelope.code || envelope.error?.code)) {
      invalidFields.push("code");
    }
    if (typeof (envelope.message || envelope.error?.message) !== "string" || !(envelope.message || envelope.error?.message)) {
      invalidFields.push("message");
    }
  }
  if (invalidFields.length > 0) {
    throw createServiceError("ELEVATED_RESULT_INVALID_SCHEMA", "IIS FTP 管理脚本返回结果缺少必要字段。", {
      operation: envelope.operation || envelope.action,
      stage: typeof envelope.stage === "string" && envelope.stage ? envelope.stage : "parse_result",
      code: "ELEVATED_RESULT_INVALID_SCHEMA",
      details: { invalidFields }
    });
  }
  if (envelope.ok === false) {
    const diagnostics = envelopeDiagnostics(envelope);
    throw createServiceError(
      diagnostics.code || "IIS_CONFIG_FAILED",
      diagnostics.message || "Windows IIS FTP 操作失败。",
      diagnostics
    );
  }
  return envelope.data as T;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForStableFile(filePath: string, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let previousSize = -1;
  let stableReads = 0;
  while (Date.now() < deadline) {
    try {
      const stat = await fs.stat(filePath);
      if (stat.size > 0 && stat.size === previousSize) stableReads += 1;
      else stableReads = 0;
      previousSize = stat.size;
      if (stableReads >= STABLE_FILE_READS) return true;
    } catch {
      previousSize = -1;
      stableReads = 0;
    }
    await delay(STABLE_FILE_INTERVAL_MS);
  }
  return false;
}

async function readStatusFile(statusPath: string): Promise<StatusFile | null> {
  try {
    if (!await waitForStableFile(statusPath, 500)) return null;
    return JSON.parse((await fs.readFile(statusPath, "utf8")).replace(/^\uFEFF/, "")) as StatusFile;
  } catch {
    return null;
  }
}

function uacStatusFor(
  elevated: boolean,
  status: StatusFile | null,
  errorCode = ""
): "not_requested" | "requested" | "accepted" | "cancelled" | "unknown" {
  if (!elevated) return "not_requested";
  if (errorCode === "UAC_CANCELLED" || status?.code === "UAC_CANCELLED" || status?.stage === "uac_cancelled") {
    return "cancelled";
  }
  if ((status?.processId ?? 0) > 0 || ["process_started", "process_completed"].includes(status?.stage || "")) {
    return "accepted";
  }
  if (status?.stage === "uac_requested") return "requested";
  return "unknown";
}

function monitorUncertainElevatedOperation(operation: OperationFiles, scriptName: string): void {
  const poll = async (): Promise<void> => {
    if (uncertainElevatedOperation?.operationId !== operation.operationId) return;
    const status = await readStatusFile(operation.statusPath);
    const terminal = ["process_completed", "launch_failed", "uac_cancelled"].includes(status?.stage || "");
    if (!terminal) {
      const timer = setTimeout(() => { void poll(); }, 1000);
      timer.unref?.();
      return;
    }
    safeLog("warn", {
      operationId: operation.operationId,
      operation: status?.operation,
      scriptName,
      stage: status?.stage,
      exitCode: status?.exitCode,
      resultFileCreated: await fs.pathExists(operation.outputPath)
    }, "超时后的管理员进程已结束；后续操作可重新读取 IIS 实际状态");
    uncertainElevatedOperation = null;
    await cleanupOperationDir(operation.operationDir);
  };
  void poll();
}

export function redactDiagnosticText(value: string): string {
  return value
    .replace(/("[^"\r\n]*(?:password|passphrase|secret|token|securestring|credential)[^"\r\n]*"\s*:\s*)"(?:\\.|[^"\\])*"/gi, '$1"[redacted]"')
    .replace(/("?[\w.-]*(?:password|passphrase|secret|token|securestring|credential)[\w.-]*"?\s*[=:]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}]+)/gi, "$1[redacted]")
    .slice(0, MAX_DIAGNOSTIC_PREVIEW_LENGTH);
}

async function readScriptResult<T>(
  operation: OperationFiles,
  scriptName: string,
  processResult: ProcessResult
): Promise<T> {
  const outputReady = await waitForStableFile(operation.outputPath);
  const status = await readStatusFile(operation.statusPath);
  if (!outputReady) {
    const diagnostics: PowerShellJsonDiagnostics = {
      operationId: operation.operationId,
      operation: status?.operation,
      scriptName,
      stage: status?.stage || "result_file_missing",
      code: status?.code,
      message: status?.message,
      exitCode: processResult.exitCode,
      timestamp: status?.timestamp
    };
    if (status?.code === "UAC_CANCELLED" || processResult.exitCode === 1223) {
      throw createServiceError("UAC_CANCELLED", "用户取消了管理员授权。未修改 IIS 配置。", diagnostics);
    }
    if (status?.stage === "launch_failed") {
      throw createServiceError("ELEVATED_SCRIPT_LAUNCH_FAILED", "无法启动管理员权限的 IIS FTP 管理脚本。", diagnostics);
    }
    throw createServiceError(
      "ELEVATED_SCRIPT_NO_RESULT",
      processResult.exitCode === 0
        ? "IIS FTP 管理脚本未返回结构化结果。"
        : `IIS FTP 管理脚本在“${status?.stage || "未知阶段"}”退出，未生成结果文件（退出码 ${processResult.exitCode}）。`,
      diagnostics
    );
  }

  let parsed: unknown;
  let raw = "";
  const parseDeadline = Date.now() + 3000;
  while (Date.now() < parseDeadline) {
    try {
      raw = (await fs.readFile(operation.outputPath, "utf8")).replace(/^\uFEFF/, "").trim();
      parsed = JSON.parse(raw);
      break;
    } catch {
      await delay(STABLE_FILE_INTERVAL_MS);
    }
  }
  if (parsed === undefined) {
    safeLog("error", {
      operationId: operation.operationId,
      operation: status?.operation,
      scriptName,
      stage: status?.stage,
      exitCode: processResult.exitCode,
      diagnosticPreview: redactDiagnosticText(raw)
    }, "IIS FTP 提权脚本结果 JSON 无法解析");
    throw createServiceError("ELEVATED_RESULT_INVALID_JSON", "IIS FTP 管理脚本返回了不完整或无效的 JSON。", {
      operationId: operation.operationId,
      operation: status?.operation,
      scriptName,
      stage: status?.stage || "parse_result",
      exitCode: processResult.exitCode
    });
  }

  try {
    return parsePowerShellJsonEnvelope<T>(parsed);
  } catch (error) {
    const serviceError = error as PowerShellServiceError;
    serviceError.diagnostics = {
      operationId: operation.operationId,
      scriptName,
      exitCode: processResult.exitCode,
      ...serviceError.diagnostics
    };
    throw serviceError;
  }
}

function elevatedRunnerScript(): string {
  return [
    "param([string]$ScriptPath,[string]$InputPath,[string]$OutputPath,[string]$StatusPath,[string]$OperationId,[string]$Operation)",
    "$ErrorActionPreference = 'Stop'",
    "function Write-Status([string]$Stage,[int]$ExitCode = -2147483648,[int]$ProcessId = 0,[string]$Code = '',[string]$Message = '') {",
    "  $value = [ordered]@{ operationId = $OperationId; operation = $Operation; stage = $Stage; timestamp = [DateTimeOffset]::UtcNow.ToString('o') }",
    "  if ($ExitCode -ne -2147483648) { $value.exitCode = $ExitCode }",
    "  if ($ProcessId -gt 0) { $value.processId = $ProcessId }",
    "  if ($Code) { $value.code = $Code }",
    "  if ($Message) { $value.message = $Message }",
    "  $value | ConvertTo-Json -Depth 5 -Compress | Set-Content -LiteralPath $StatusPath -Encoding UTF8",
    "}",
    "try {",
    "  Write-Status -Stage 'process_starting'",
    "  $arguments = @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File', ('\"' + $ScriptPath + '\"'), '-InputPath', ('\"' + $InputPath + '\"'), '-OutputPath', ('\"' + $OutputPath + '\"'))",
    `  $child = Start-Process -FilePath ${powershellLiteral(windowsPowerShellExecutable())} -ArgumentList $arguments -WindowStyle Hidden -PassThru`,
    "  Write-Status -Stage 'process_started' -ProcessId $child.Id",
    "  $child.WaitForExit()",
    "  $exitCode = [int]$child.ExitCode",
    "  Write-Status -Stage 'process_completed' -ExitCode $exitCode -ProcessId $child.Id",
    "  exit $exitCode",
    "} catch {",
    "  $message = [string]$_.Exception.Message",
    "  Write-Status -Stage 'launch_failed' -ExitCode 1 -Code 'ELEVATED_SCRIPT_LAUNCH_FAILED' -Message $message",
    "  if (-not (Test-Path -LiteralPath $OutputPath)) {",
    "    [ordered]@{ ok = $false; operation = $Operation; stage = 'launch_failed'; code = 'ELEVATED_SCRIPT_LAUNCH_FAILED'; message = '无法启动管理员权限的 IIS FTP 管理脚本。'; technicalMessage = $message; exceptionType = [string]$_.Exception.GetType().FullName; command = 'Start-Process'; rollbackAttempted = $false; rollbackSucceeded = $null; warnings = @(); timestamp = [DateTimeOffset]::UtcNow.ToString('o'); data = $null } | ConvertTo-Json -Depth 8 -Compress | Set-Content -LiteralPath $OutputPath -Encoding UTF8",
    "  }",
    "  exit 1",
    "}"
  ].join("\r\n");
}

function quotedPowerShellArgumentLiteral(value: string): string {
  return `('\"' + ${powershellLiteral(value)} + '\"')`;
}

function uacLauncherScript(
  operation: OperationFiles,
  runnerPath: string,
  scriptPath: string,
  operationLabel: string
): string {
  const runnerArguments = [
    "'-NoProfile'",
    "'-NonInteractive'",
    "'-ExecutionPolicy'",
    "'Bypass'",
    "'-File'",
    quotedPowerShellArgumentLiteral(runnerPath),
    "'-ScriptPath'",
    quotedPowerShellArgumentLiteral(scriptPath),
    "'-InputPath'",
    quotedPowerShellArgumentLiteral(operation.inputPath),
    "'-OutputPath'",
    quotedPowerShellArgumentLiteral(operation.outputPath),
    "'-StatusPath'",
    quotedPowerShellArgumentLiteral(operation.statusPath),
    "'-OperationId'",
    quotedPowerShellArgumentLiteral(operation.operationId),
    "'-Operation'",
    quotedPowerShellArgumentLiteral(operationLabel)
  ].join(",");
  return [
    "$ErrorActionPreference = 'Stop'",
    `function Write-Status([string]$Stage,[string]$Code = '',[string]$Message = '',[int]$ProcessId = 0) { $value = [ordered]@{ operationId = ${powershellLiteral(operation.operationId)}; operation = ${powershellLiteral(operationLabel)}; stage = $Stage; timestamp = [DateTimeOffset]::UtcNow.ToString('o') }; if ($Code) { $value.code = $Code }; if ($Message) { $value.message = $Message }; if ($ProcessId -gt 0) { $value.processId = $ProcessId }; $value | ConvertTo-Json -Depth 5 -Compress | Set-Content -LiteralPath ${powershellLiteral(operation.statusPath)} -Encoding UTF8 }`,
    "try {",
    "  Write-Status -Stage 'uac_requested'",
    `  $arguments = @(${runnerArguments})`,
    `  $process = Start-Process -FilePath ${powershellLiteral(windowsPowerShellExecutable())} -Verb RunAs -ArgumentList $arguments -WindowStyle Hidden -PassThru`,
    "  Write-Status -Stage 'uac_accepted' -ProcessId $process.Id",
    "  $process.WaitForExit()",
    "  exit ([int]$process.ExitCode)",
    "} catch {",
    "  $nativeCode = 0",
    "  if ($_.Exception.PSObject.Properties.Name -contains 'NativeErrorCode') { $nativeCode = [int]$_.Exception.NativeErrorCode }",
    "  $cancelled = $nativeCode -eq 1223",
    "  $code = if ($cancelled) { 'UAC_CANCELLED' } else { 'ELEVATED_SCRIPT_LAUNCH_FAILED' }",
    "  $stage = if ($cancelled) { 'uac_cancelled' } else { 'launch_failed' }",
    "  $message = if ($cancelled) { '用户取消了管理员授权。未修改 IIS 配置。' } else { '无法启动管理员权限的 IIS FTP 管理操作。' }",
    "  Write-Status -Stage $stage -Code $code -Message $message",
    `  [ordered]@{ ok = $false; operation = ${powershellLiteral(operationLabel)}; stage = $stage; code = $code; message = $message; technicalMessage = if ($cancelled) { '' } else { [string]$_.Exception.Message }; exceptionType = [string]$_.Exception.GetType().FullName; command = 'Start-Process'; rollbackAttempted = $false; rollbackSucceeded = $null; warnings = @(); timestamp = [DateTimeOffset]::UtcNow.ToString('o'); data = $null } | ConvertTo-Json -Depth 8 -Compress | Set-Content -LiteralPath ${powershellLiteral(operation.outputPath)} -Encoding UTF8`,
    "  if ($cancelled) { exit 1223 }",
    "  exit 1",
    "}"
  ].join("\r\n");
}

async function executeJsonScript<T>(
  scriptName: string,
  input: unknown,
  options: PowerShellJsonOptions
): Promise<T> {
  assertWindows();
  const scriptPath = resolveWindowsScriptPath(scriptName);
  const timeoutMs = Math.max(5_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const operation = await createOperationFiles(input);
  const operationLabel = operationName(input);
  const requestedAt = Date.now();
  let preserveOperationDir = false;

  safeLog("info", {
    operationId: operation.operationId,
    parentOperationId: operation.parentOperationId,
    operation: operationLabel,
    scriptName,
    requestTime: new Date(requestedAt).toISOString(),
    elevated: options.elevated === true
  }, "IIS FTP PowerShell 操作已创建");

  try {
    let result: ProcessResult;
    if (!options.elevated) {
      await writeStatus(operation.statusPath, {
        operationId: operation.operationId,
        operation: operationLabel,
        stage: "process_starting"
      });
      result = await runProcess(
        windowsPowerShellExecutable(),
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          scriptPath,
          "-InputPath",
          operation.inputPath,
          "-OutputPath",
          operation.outputPath
        ],
        timeoutMs
      );
      await writeStatus(operation.statusPath, {
        operationId: operation.operationId,
        operation: operationLabel,
        stage: "process_completed",
        exitCode: result.exitCode
      });
    } else {
      const runnerPath = path.join(operation.operationDir, `${crypto.randomUUID()}.elevated-runner.ps1`);
      const launcherPath = path.join(operation.operationDir, `${crypto.randomUUID()}.request-uac.ps1`);
      // Windows PowerShell 5.1 treats UTF-8 without BOM as the active ANSI
      // code page. A BOM is required because temp/project paths and localized
      // fallback messages can contain Chinese characters.
      await fs.writeFile(runnerPath, `\uFEFF${elevatedRunnerScript()}`, { encoding: "utf8", mode: 0o600 });
      await fs.writeFile(
        launcherPath,
        `\uFEFF${uacLauncherScript(operation, runnerPath, scriptPath, operationLabel)}`,
        { encoding: "utf8", mode: 0o600 }
      );
      safeLog("info", {
        operationId: operation.operationId,
        operation: operationLabel,
        scriptName,
        stage: "uac_requested",
        uacStatus: "requested"
      }, "IIS FTP 操作正在请求 UAC");
      result = await runProcess(
        windowsPowerShellExecutable(),
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", launcherPath],
        timeoutMs
      );
    }

    if (options.elevated) {
      const postProcessStatus = await readStatusFile(operation.statusPath);
      safeLog("info", {
        operationId: operation.operationId,
        operation: operationLabel,
        scriptName,
        stage: postProcessStatus?.stage || "unknown",
        uacStatus: uacStatusFor(true, postProcessStatus),
        processStarted: (postProcessStatus?.processId ?? 0) > 0,
        processId: postProcessStatus?.processId,
        exitCode: result.exitCode,
        resultFileCreated: await fs.pathExists(operation.outputPath)
      }, "IIS FTP UAC 与管理员进程结果已确认");
    }

    const parsed = await readScriptResult<T>(operation, scriptName, result);
    // Keep the launcher operation id attached to successful structured
    // results as well as failures.  This lets the API, UI and logs refer to
    // the same transaction without ever placing a password in a command line
    // or diagnostic payload.
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      if (typeof record.operationId !== "string") record.operationId = operation.operationId;
      if (operation.parentOperationId && typeof record.parentOperationId !== "string") {
        record.parentOperationId = operation.parentOperationId;
      }
    }
    const status = await readStatusFile(operation.statusPath);
    safeLog("info", {
      operationId: operation.operationId,
      operation: operationLabel,
      scriptName,
      stage: status?.stage || "completed",
      exitCode: result.exitCode,
      durationMs: Date.now() - requestedAt,
      resultFileCreated: true,
      uacStatus: uacStatusFor(options.elevated === true, status),
      processStarted: options.elevated ? (status?.processId ?? 0) > 0 : true
    }, "IIS FTP PowerShell 操作完成");
    return parsed;
  } catch (error) {
    const serviceError = error as PowerShellServiceError;
    const status = await readStatusFile(operation.statusPath);
    const resultFileCreated = await fs.pathExists(operation.outputPath);
    if (serviceError.code === "ELEVATED_SCRIPT_TIMEOUT") {
      const uacStatus = uacStatusFor(options.elevated === true, status, serviceError.code);
      const processStarted = options.elevated === true && ((status?.processId ?? 0) > 0
        || ["uac_accepted", "process_starting", "process_started"].includes(status?.stage || ""));
      serviceError.diagnostics = {
        operationId: operation.operationId,
        parentOperationId: operation.parentOperationId,
        operation: operationLabel,
        scriptName,
        stage: status?.stage || "timeout",
        code: serviceError.code,
        message: serviceError.message,
        timestamp: status?.timestamp,
        rollbackAttempted: false,
        rollbackSucceeded: null,
        systemStateUnknown: processStarted,
        details: {
          systemStateUnknown: processStarted,
          uacStatus,
          processStarted
        }
      };
      if (processStarted) {
        preserveOperationDir = true;
        uncertainElevatedOperation = operation;
        monitorUncertainElevatedOperation(operation, scriptName);
      }
    }
    serviceError.diagnostics = {
      ...(serviceError.diagnostics || {}),
      operationId: serviceError.diagnostics?.operationId || operation.operationId,
      parentOperationId: serviceError.diagnostics?.parentOperationId || operation.parentOperationId
    };
    safeLog("error", {
      operationId: operation.operationId,
      operation: operationLabel,
      scriptName,
      stage: serviceError.diagnostics?.stage || status?.stage || "unknown",
      code: serviceError.code || "IIS_CONFIG_FAILED",
      structuredCode: serviceError.diagnostics?.code,
      exitCode: serviceError.diagnostics?.exitCode ?? status?.exitCode,
      rollbackAttempted: serviceError.diagnostics?.rollbackAttempted,
      rollbackSucceeded: serviceError.diagnostics?.rollbackSucceeded,
      durationMs: Date.now() - requestedAt,
      uacStatus: uacStatusFor(options.elevated === true, status, serviceError.code),
      processStarted: options.elevated ? (status?.processId ?? 0) > 0 : true,
      processId: status?.processId,
      resultFileCreated,
      technicalMessage: serviceError.diagnostics?.technicalMessage
        ? redactDiagnosticText(serviceError.diagnostics.technicalMessage).slice(0, MAX_DIAGNOSTIC_PREVIEW_LENGTH)
        : undefined,
      exceptionType: serviceError.diagnostics?.exceptionType,
      command: serviceError.diagnostics?.command
    }, "IIS FTP PowerShell 操作失败");
    throw serviceError;
  } finally {
    if (!preserveOperationDir) await cleanupOperationDir(operation.operationDir);
  }
}

export async function runPowerShellJsonScript<T>(
  scriptName: string,
  input: unknown = {},
  options: Omit<PowerShellJsonOptions, "elevated"> = {}
): Promise<T> {
  return executeJsonScript<T>(scriptName, input, { ...options, elevated: false });
}

export async function runElevatedPowerShellJsonScript<T>(
  scriptName: string,
  input: unknown = {},
  options: Omit<PowerShellJsonOptions, "elevated"> = {}
): Promise<T> {
  const pendingOperation = getUncertainElevatedOperation();
  if (pendingOperation) {
    throw createServiceError("ELEVATED_STATE_UNKNOWN", "上一项管理员操作超时且仍可能在执行。请等待其结束后重新检测 IIS 状态。", {
      operationId: pendingOperation.operationId,
      stage: "previous_operation_still_running",
      code: "ELEVATED_STATE_UNKNOWN",
      systemStateUnknown: true,
      rollbackAttempted: false,
      rollbackSucceeded: null
    });
  }
  const previous = elevatedQueue;
  let release!: () => void;
  elevatedQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    const pendingAfterQueue = getUncertainElevatedOperation();
    if (pendingAfterQueue) {
      throw createServiceError("ELEVATED_STATE_UNKNOWN", "上一项管理员操作超时且仍可能在执行。请等待其结束后重新检测 IIS 状态。", {
        operationId: pendingAfterQueue.operationId,
        stage: "previous_operation_still_running",
        code: "ELEVATED_STATE_UNKNOWN",
        systemStateUnknown: true,
        rollbackAttempted: false,
        rollbackSucceeded: null
      });
    }
    return await executeJsonScript<T>(scriptName, input, { ...options, elevated: true });
  } finally {
    release();
  }
}
