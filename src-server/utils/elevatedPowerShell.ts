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
  scriptName: string;
  requestedAt: number;
  operationDir: string;
  inputPath: string;
  outputPath: string;
  statusPath: string;
}

interface ElevatedOperationRootCandidate {
  path: string;
  kind: "configured" | "system_temp" | "local_app_data";
}

type TemporaryDirectoryFailure = Error & {
  step?: string;
  exitCode?: number;
  command?: string;
};

interface StatusFile {
  operationId?: string;
  parentOperationId?: string;
  operation?: string;
  scriptName?: string;
  stage?: string;
  state?: string;
  processId?: number;
  exitCode?: number;
  timestamp?: string;
  startedAt?: string;
  stageStartedAt?: string;
  lastProgressAt?: string;
  code?: string;
  message?: string;
}

export type PowerShellServiceError = Error & {
  code: string;
  diagnostics?: PowerShellJsonDiagnostics;
};

export type ElevatedAdminOperationState =
  | "idle"
  | "running"
  | "timed_out_waiting"
  | "completed"
  | "failed"
  | "abandoned";

export interface ElevatedAdminOperationStatus {
  state: ElevatedAdminOperationState;
  operationId?: string;
  parentOperationId?: string;
  action?: string;
  scriptName?: string;
  stage?: string;
  phaseIndex: number;
  phaseCount: number;
  progressPercent: number;
  indeterminate: boolean;
  startedAt?: string;
  stageStartedAt?: string;
  lastProgressAt?: string;
  elapsedMs: number;
  estimatedRemainingMinMs: number | null;
  estimatedRemainingMaxMs: number | null;
  estimateExceeded: boolean;
  processId?: number;
  safeToRetry: boolean;
}

const DEFAULT_TIMEOUT_MS = 120_000;
export const PROVISIONING_TIMEOUT_MS = 20 * 60 * 1000;
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
let activeElevatedOperation: OperationFiles | null = null;
let elevatedRecoveryPromise: Promise<void> | null = null;
let adminOperationStatus: ElevatedAdminOperationStatus = {
  state: "idle",
  phaseIndex: 0,
  phaseCount: 7,
  progressPercent: 0,
  indeterminate: false,
  elapsedMs: 0,
  estimatedRemainingMinMs: null,
  estimatedRemainingMaxMs: null,
  estimateExceeded: false,
  safeToRetry: true
};
let terminalStatusResetTimer: NodeJS.Timeout | null = null;

function getUncertainElevatedOperation(): OperationFiles | null {
  return uncertainElevatedOperation;
}

const STAGE_PRESENTATION: Record<string, {
  phaseIndex: number;
  progressPercent: number;
  minRemainingMs: number;
  maxRemainingMs: number;
  indeterminate?: boolean;
}> = {
  secure_temp_directory: { phaseIndex: 0, progressPercent: 0, minRemainingMs: 60_000, maxRemainingMs: 180_000, indeterminate: true },
  request_created: { phaseIndex: 0, progressPercent: 0, minRemainingMs: 60_000, maxRemainingMs: 180_000, indeterminate: true },
  uac_requested: { phaseIndex: 0, progressPercent: 2, minRemainingMs: 60_000, maxRemainingMs: 180_000, indeterminate: true },
  uac_accepted: { phaseIndex: 0, progressPercent: 4, minRemainingMs: 60_000, maxRemainingMs: 180_000, indeterminate: true },
  process_starting: { phaseIndex: 0, progressPercent: 5, minRemainingMs: 60_000, maxRemainingMs: 180_000, indeterminate: true },
  process_started: { phaseIndex: 0, progressPercent: 6, minRemainingMs: 60_000, maxRemainingMs: 180_000, indeterminate: true },
  read_input: { phaseIndex: 0, progressPercent: 7, minRemainingMs: 60_000, maxRemainingMs: 180_000 },
  validate_input: { phaseIndex: 0, progressPercent: 8, minRemainingMs: 60_000, maxRemainingMs: 180_000 },
  check_permissions: { phaseIndex: 0, progressPercent: 9, minRemainingMs: 60_000, maxRemainingMs: 180_000 },
  validate_configuration: { phaseIndex: 0, progressPercent: 10, minRemainingMs: 60_000, maxRemainingMs: 180_000 },
  preflight_account: { phaseIndex: 0, progressPercent: 11, minRemainingMs: 60_000, maxRemainingMs: 180_000 },
  preflight_port: { phaseIndex: 0, progressPercent: 12, minRemainingMs: 60_000, maxRemainingMs: 180_000 },
  preflight_firewall: { phaseIndex: 0, progressPercent: 13, minRemainingMs: 60_000, maxRemainingMs: 180_000 },
  inspect_iis_sites: { phaseIndex: 0, progressPercent: 14, minRemainingMs: 60_000, maxRemainingMs: 180_000 },
  enable_iis_features: { phaseIndex: 0, progressPercent: 15, minRemainingMs: 180_000, maxRemainingMs: 900_000, indeterminate: true },
  wait_iis_initialization: { phaseIndex: 0, progressPercent: 18, minRemainingMs: 60_000, maxRemainingMs: 180_000, indeterminate: true },
  open_iis_configuration: { phaseIndex: 0, progressPercent: 20, minRemainingMs: 60_000, maxRemainingMs: 180_000 },
  prepare_receive_directory: { phaseIndex: 1, progressPercent: 25, minRemainingMs: 60_000, maxRemainingMs: 120_000 },
  configure_local_account: { phaseIndex: 1, progressPercent: 30, minRemainingMs: 60_000, maxRemainingMs: 120_000 },
  configure_directory_acl: { phaseIndex: 2, progressPercent: 38, minRemainingMs: 60_000, maxRemainingMs: 120_000 },
  tighten_directory_acl: { phaseIndex: 2, progressPercent: 43, minRemainingMs: 60_000, maxRemainingMs: 120_000 },
  configure_iis_site: { phaseIndex: 3, progressPercent: 50, minRemainingMs: 60_000, maxRemainingMs: 180_000 },
  configure_passive_ports: { phaseIndex: 3, progressPercent: 57, minRemainingMs: 60_000, maxRemainingMs: 180_000 },
  commit_iis_configuration: { phaseIndex: 3, progressPercent: 62, minRemainingMs: 60_000, maxRemainingMs: 180_000, indeterminate: true },
  configure_firewall: { phaseIndex: 4, progressPercent: 70, minRemainingMs: 60_000, maxRemainingMs: 180_000 },
  start_ftp_service: { phaseIndex: 5, progressPercent: 80, minRemainingMs: 0, maxRemainingMs: 120_000, indeterminate: true },
  start_ftp_site: { phaseIndex: 5, progressPercent: 85, minRemainingMs: 0, maxRemainingMs: 120_000, indeterminate: true },
  verify_ftp_listener: { phaseIndex: 6, progressPercent: 90, minRemainingMs: 0, maxRemainingMs: 120_000, indeterminate: true },
  verify_configuration: { phaseIndex: 6, progressPercent: 94, minRemainingMs: 0, maxRemainingMs: 120_000 },
  process_completed: { phaseIndex: 6, progressPercent: 98, minRemainingMs: 0, maxRemainingMs: 30_000, indeterminate: true },
  completed: { phaseIndex: 6, progressPercent: 100, minRemainingMs: 0, maxRemainingMs: 0 }
};

function stagePresentation(stage = "") {
  return STAGE_PRESENTATION[stage] || {
    phaseIndex: 0,
    progressPercent: 5,
    minRemainingMs: 60_000,
    maxRemainingMs: 180_000,
    indeterminate: true
  };
}

function stageElapsedMs(status: StatusFile | null, now: number): number {
  const value = status?.stageStartedAt || status?.timestamp;
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? Math.max(0, now - parsed) : 0;
}

function buildAdminOperationStatus(
  operation: OperationFiles,
  status: StatusFile | null,
  state: ElevatedAdminOperationState,
  safeToRetry: boolean,
  now = Date.now()
): ElevatedAdminOperationStatus {
  const stage = status?.stage || "request_created";
  const presentation = stagePresentation(stage);
  const stageElapsed = stageElapsedMs(status, now);
  const estimateExceeded = presentation.maxRemainingMs > 0 && stageElapsed > presentation.maxRemainingMs;
  return {
    state,
    operationId: operation.operationId,
    parentOperationId: operation.parentOperationId || status?.parentOperationId,
    action: status?.operation,
    scriptName: operation.scriptName || status?.scriptName,
    stage,
    phaseIndex: presentation.phaseIndex,
    phaseCount: 7,
    progressPercent: state === "completed" ? 100 : presentation.progressPercent,
    indeterminate: state === "running" && presentation.indeterminate === true,
    startedAt: new Date(operation.requestedAt).toISOString(),
    stageStartedAt: status?.stageStartedAt || status?.timestamp,
    lastProgressAt: status?.lastProgressAt || status?.timestamp,
    elapsedMs: Math.max(0, now - operation.requestedAt),
    estimatedRemainingMinMs: estimateExceeded || state !== "running"
      ? null
      : Math.max(0, presentation.minRemainingMs - stageElapsed),
    estimatedRemainingMaxMs: estimateExceeded || state !== "running"
      ? null
      : Math.max(0, presentation.maxRemainingMs - stageElapsed),
    estimateExceeded,
    processId: status?.processId,
    safeToRetry
  };
}

const TERMINAL_ADMIN_OPERATION_STATES = new Set<ElevatedAdminOperationState>([
  "completed",
  "failed",
  "abandoned"
]);

export function mergeElevatedAdminOperationStatus(
  current: ElevatedAdminOperationStatus,
  incoming: ElevatedAdminOperationStatus
): ElevatedAdminOperationStatus {
  if (!current.operationId || current.operationId !== incoming.operationId) return incoming;
  if (TERMINAL_ADMIN_OPERATION_STATES.has(current.state)) return current;
  if (TERMINAL_ADMIN_OPERATION_STATES.has(incoming.state)) return incoming;
  if (current.state === "timed_out_waiting" && incoming.state === "running") return current;

  const currentProgress = Math.max(0, current.progressPercent);
  const incomingProgress = Math.max(0, incoming.progressPercent);
  if (incoming.phaseIndex < current.phaseIndex || incomingProgress < currentProgress) {
    return {
      ...current,
      elapsedMs: Math.max(current.elapsedMs, incoming.elapsedMs),
      estimateExceeded: current.estimateExceeded || incoming.estimateExceeded
    };
  }
  return {
    ...incoming,
    phaseIndex: Math.max(current.phaseIndex, incoming.phaseIndex),
    progressPercent: Math.max(currentProgress, incomingProgress),
    elapsedMs: Math.max(current.elapsedMs, incoming.elapsedMs)
  };
}

function setAdminOperationStatus(value: ElevatedAdminOperationStatus): ElevatedAdminOperationStatus {
  adminOperationStatus = mergeElevatedAdminOperationStatus(adminOperationStatus, value);
  if (terminalStatusResetTimer) {
    clearTimeout(terminalStatusResetTimer);
    terminalStatusResetTimer = null;
  }
  if (TERMINAL_ADMIN_OPERATION_STATES.has(adminOperationStatus.state)) {
    const terminalValue = adminOperationStatus;
    terminalStatusResetTimer = setTimeout(() => {
      if (adminOperationStatus.operationId !== terminalValue.operationId) return;
      adminOperationStatus = {
        state: "idle",
        phaseIndex: 0,
        phaseCount: 7,
        progressPercent: 0,
        indeterminate: false,
        elapsedMs: 0,
        estimatedRemainingMinMs: null,
        estimatedRemainingMaxMs: null,
        estimateExceeded: false,
        safeToRetry: true
      };
    }, 5 * 60 * 1000);
    terminalStatusResetTimer.unref?.();
  }
  return adminOperationStatus;
}

export async function getElevatedAdminOperationStatus(): Promise<ElevatedAdminOperationStatus> {
  await ensureElevatedOperationRecovery();
  const operation = activeElevatedOperation || uncertainElevatedOperation;
  if (!operation) {
    return {
      ...adminOperationStatus,
      elapsedMs: ["running", "timed_out_waiting"].includes(adminOperationStatus.state)
        && adminOperationStatus.startedAt
        ? Math.max(0, Date.now() - Date.parse(adminOperationStatus.startedAt))
        : adminOperationStatus.elapsedMs
    };
  }
  const status = await readStatusFile(operation.statusPath);
  const stillActive = activeElevatedOperation?.operationId === operation.operationId
    || uncertainElevatedOperation?.operationId === operation.operationId;
  if (!stillActive) {
    return {
      ...adminOperationStatus,
      elapsedMs: ["running", "timed_out_waiting"].includes(adminOperationStatus.state)
        && adminOperationStatus.startedAt
        ? Math.max(0, Date.now() - Date.parse(adminOperationStatus.startedAt))
        : adminOperationStatus.elapsedMs
    };
  }
  const state = uncertainElevatedOperation?.operationId === operation.operationId
    ? "timed_out_waiting"
    : "running";
  const value = buildAdminOperationStatus(operation, status, state, false);
  return setAdminOperationStatus(value);
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
    let timedOut = false;
    let timeoutCloseFallback: NodeJS.Timeout | null = null;
    const rejectTimeout = () => {
      if (settled) return;
      settled = true;
      reject(createServiceError("ELEVATED_SCRIPT_TIMEOUT", "IIS FTP 管理操作等待超时。"));
    };
    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      child.kill();
      // Wait briefly for the launcher handle to close so temp cleanup is not
      // racy on Windows. This does not terminate or wait for the separately
      // elevated IIS/Windows-component process.
      timeoutCloseFallback = setTimeout(rejectTimeout, 1500);
      timeoutCloseFallback.unref?.();
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
      if (timeoutCloseFallback) clearTimeout(timeoutCloseFallback);
      reject(timedOut
        ? createServiceError("ELEVATED_SCRIPT_TIMEOUT", "IIS FTP 管理操作等待超时。")
        : error);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (timeoutCloseFallback) clearTimeout(timeoutCloseFallback);
      if (timedOut) {
        reject(createServiceError("ELEVATED_SCRIPT_TIMEOUT", "IIS FTP 管理操作等待超时。"));
      } else {
        resolve({ exitCode: code ?? -1, stdout, stderr });
      }
    });
  });
}

function temporaryDirectoryFailure(
  message: string,
  step: string,
  command: string,
  exitCode?: number
): TemporaryDirectoryFailure {
  return Object.assign(new Error(message), { step, command, exitCode });
}

export function parseWindowsUserSid(value: string): string | null {
  return value.match(/\bS-\d-(?:\d+-)+\d+\b/i)?.[0] || null;
}

async function currentWindowsAclPrincipal(): Promise<string> {
  try {
    const currentUser = await runProcess("whoami.exe", ["/user", "/fo", "csv", "/nh"], 5000);
    const sid = currentUser.exitCode === 0 ? parseWindowsUserSid(currentUser.stdout) : null;
    if (sid) return `*${sid}`;
  } catch {
    // Fall back to the account name only when SID discovery is unavailable.
  }

  let identity = "";
  try {
    const currentIdentity = await runProcess("whoami.exe", [], 5000);
    if (currentIdentity.exitCode === 0) identity = currentIdentity.stdout.trim();
  } catch {
    identity = "";
  }
  if (!identity) {
    const username = process.env.USERNAME?.trim();
    identity = username
      ? process.env.USERDOMAIN?.trim() ? `${process.env.USERDOMAIN.trim()}\\${username}` : username
      : "";
  }
  if (!identity || /[\r\n]/.test(identity)) {
    throw temporaryDirectoryFailure(
      "无法确定当前 Windows 用户。",
      "resolve_current_user",
      "whoami.exe /user"
    );
  }
  return identity;
}

async function applyStrictWindowsAcl(targetPath: string): Promise<void> {
  if (process.platform !== "win32") {
    await fs.chmod(targetPath, 0o700);
    return;
  }

  const currentPrincipal = await currentWindowsAclPrincipal();
  const steps = [
    {
      name: "grant_current_user",
      label: "icacls.exe /grant:r current-user",
      args: [targetPath, "/grant:r", `${currentPrincipal}:(OI)(CI)F`]
    },
    {
      name: "grant_administrators",
      label: "icacls.exe /grant:r administrators",
      args: [targetPath, "/grant:r", "*S-1-5-32-544:(OI)(CI)F"]
    },
    {
      name: "grant_system",
      label: "icacls.exe /grant:r system",
      args: [targetPath, "/grant:r", "*S-1-5-18:(OI)(CI)F"]
    },
    {
      name: "remove_inheritance",
      label: "icacls.exe /inheritance:r",
      args: [targetPath, "/inheritance:r"]
    },
    {
      name: "verify_acl",
      label: "icacls.exe /verify",
      args: [targetPath, "/verify"]
    }
  ];

  for (const step of steps) {
    let result: ProcessResult;
    try {
      result = await runProcess("icacls.exe", step.args, 15_000);
    } catch (error: any) {
      throw temporaryDirectoryFailure(
        typeof error?.message === "string" ? error.message : "无法执行 Windows ACL 命令。",
        step.name,
        step.label
      );
    }
    if (result.exitCode !== 0) {
      throw temporaryDirectoryFailure(
        `Windows ACL 命令在 ${step.name} 阶段退出。`,
        step.name,
        step.label,
        result.exitCode
      );
    }
  }
}

export function elevatedOperationRootCandidates(
  environment: NodeJS.ProcessEnv = process.env,
  systemTempDirectory = os.tmpdir()
): ElevatedOperationRootCandidate[] {
  const candidates: ElevatedOperationRootCandidate[] = [];
  const configuredRoot = environment.MPW_ELEVATED_TEMP_ROOT?.trim();
  if (configuredRoot) candidates.push({ path: path.resolve(configuredRoot), kind: "configured" });
  candidates.push({
    path: path.join(systemTempDirectory, APP_TEMP_FOLDER, "elevated"),
    kind: "system_temp"
  });
  const localAppData = environment.LOCALAPPDATA?.trim();
  if (localAppData) {
    candidates.push({
      path: path.join(localAppData, APP_TEMP_FOLDER, "secure-temp", "elevated"),
      kind: "local_app_data"
    });
  }
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = path.resolve(candidate.path).toLocaleLowerCase("en-US");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

async function createOperationFiles(input: unknown, scriptName: string): Promise<OperationFiles> {
  const operationId = crypto.randomUUID();
  const parentOperationId = getCurrentOperationId();
  const requestedAt = Date.now();
  const operation = operationName(input);
  const attempts: Array<{
    rootKind: ElevatedOperationRootCandidate["kind"];
    step: string;
    exitCode?: number;
    exceptionType?: string;
    command?: string;
  }> = [];

  for (const root of elevatedOperationRootCandidates()) {
    const operationDir = path.join(root.path, operationId);
    try {
      await fs.ensureDir(operationDir);
      await applyStrictWindowsAcl(operationDir);
      const inputPath = path.join(operationDir, `${crypto.randomUUID()}.input.json`);
      const outputPath = path.join(operationDir, `${crypto.randomUUID()}.output.json`);
      const statusPath = path.join(operationDir, `${crypto.randomUUID()}.status.json`);
      await fs.writeFile(inputPath, JSON.stringify(input), { encoding: "utf8", mode: 0o600 });
      await writeStatus(statusPath, {
        operationId,
        parentOperationId,
        operation,
        scriptName,
        stage: "request_created",
        state: "running",
        startedAt: new Date(requestedAt).toISOString(),
        stageStartedAt: new Date(requestedAt).toISOString(),
        lastProgressAt: new Date(requestedAt).toISOString()
      });
      if (attempts.length > 0) {
        safeLog("warn", {
          operationId,
          operation,
          scriptName,
          selectedRootKind: root.kind,
          failedRootKinds: attempts.map((attempt) => attempt.rootKind)
        }, "默认管理员临时目录不可用，已切换到受保护的备用目录");
      }
      return {
        operationId,
        parentOperationId,
        scriptName,
        requestedAt,
        operationDir,
        inputPath,
        outputPath,
        statusPath
      };
    } catch (error: any) {
      const failure = error as TemporaryDirectoryFailure;
      attempts.push({
        rootKind: root.kind,
        step: failure.step || (await fs.pathExists(operationDir) ? "secure_acl" : "create_directory"),
        exitCode: failure.exitCode,
        exceptionType: typeof error?.name === "string" ? error.name : "Error",
        command: failure.command
      });
      await fs.remove(operationDir).catch(() => undefined);
    }
  }

  const lastAttempt = attempts[attempts.length - 1];
  throw createServiceError(
    "TEMP_ACL_FAILED",
    "无法建立受保护的管理员临时目录。工作台未启动管理员脚本，也未修改 IIS、账户、目录权限或防火墙。",
    {
      operationId,
      parentOperationId,
      operation,
      scriptName,
      stage: "secure_temp_directory",
      code: "TEMP_ACL_FAILED",
      technicalMessage: attempts.map((attempt) => [
        attempt.rootKind,
        attempt.step,
        attempt.exitCode === undefined ? "" : `exit=${attempt.exitCode}`
      ].filter(Boolean).join(":")).join("; "),
      exceptionType: lastAttempt?.exceptionType,
      command: lastAttempt?.command,
      exitCode: lastAttempt?.exitCode,
      rollbackAttempted: false,
      rollbackSucceeded: null,
      timestamp: new Date().toISOString(),
      details: {
        safeToRetry: true,
        systemStateChanged: false,
        attempts
      }
    }
  );
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
  await Promise.all(elevatedOperationRootCandidates().map(async ({ path: root }) => {
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
        const terminal = ["process_completed", "launch_failed", "uac_cancelled"].includes(status?.stage || "");
        const mayStillBeRunning = !terminal && (status?.processId ?? 0) > 0;
        if (mayStillBeRunning && ageMs < ACTIVE_OPERATION_MAX_AGE_MS) return;
        await fs.remove(directory);
      } catch {
        // Best effort only; never inspect or log secret-bearing input contents.
      }
    }));
  }));
}

function processMayExist(processId: number | undefined): boolean {
  if (!processId || processId <= 0) return false;
  try {
    process.kill(processId, 0);
    return true;
  } catch (error: any) {
    return error?.code === "EPERM";
  }
}

async function recoverElevatedOperationState(): Promise<void> {
  let directories: Array<{ path: string; mtimeMs: number }> = [];
  for (const { path: root } of elevatedOperationRootCandidates()) {
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      directories.push(...await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
        const directory = path.join(root, entry.name);
        const stat = await fs.stat(directory);
        return { path: directory, mtimeMs: stat.mtimeMs };
      })));
    } catch {
      // Continue with the remaining candidate roots.
    }
  }
  directories.sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const entry of directories) {
    try {
      const files = await fs.readdir(entry.path);
      const statusName = files.find((name) => name.endsWith(".status.json"));
      if (!statusName) continue;
      const statusPath = path.join(entry.path, statusName);
      const status = await readStatusFile(statusPath);
      if (!status?.operationId) continue;
      const terminal = ["process_completed", "launch_failed", "uac_cancelled"].includes(status.stage || "");
      const inputName = files.find((name) => name.endsWith(".input.json")) || `${status.operationId}.input.json`;
      const outputName = files.find((name) => name.endsWith(".output.json")) || `${status.operationId}.output.json`;
      const startedAt = Date.parse(status.startedAt || status.stageStartedAt || status.timestamp || "");
      const operation: OperationFiles = {
        operationId: status.operationId,
        parentOperationId: status.parentOperationId,
        scriptName: status.scriptName || "iis-ftp-setup.ps1",
        requestedAt: Number.isFinite(startedAt) ? startedAt : entry.mtimeMs,
        operationDir: entry.path,
        inputPath: path.join(entry.path, inputName),
        outputPath: path.join(entry.path, outputName),
        statusPath
      };

      if (!terminal && processMayExist(status.processId)) {
        uncertainElevatedOperation = operation;
        setAdminOperationStatus(buildAdminOperationStatus(operation, status, "timed_out_waiting", false));
        monitorUncertainElevatedOperation(operation, operation.scriptName);
        safeLog("warn", {
          operationId: operation.operationId,
          scriptName: operation.scriptName,
          stage: status.stage,
          processId: status.processId
        }, "工作台启动时恢复了仍在执行的管理员操作监控");
        return;
      }

      if (!terminal) {
        setAdminOperationStatus(buildAdminOperationStatus(operation, status, "abandoned", true));
        safeLog("warn", {
          operationId: operation.operationId,
          scriptName: operation.scriptName,
          stage: status.stage,
          processId: status.processId
        }, "管理员操作状态文件未结束，但对应进程已不存在；已允许重新检测");
        await cleanupOperationDir(entry.path);
        return;
      }
      let recoveredState: ElevatedAdminOperationState = status.exitCode === 0 ? "completed" : "failed";
      try {
        if (await waitForStableFile(operation.outputPath, 1000)) {
          const envelope = JSON.parse((await fs.readFile(operation.outputPath, "utf8")).replace(/^\uFEFF/, "")) as {
            ok?: boolean;
          };
          recoveredState = envelope.ok === true ? "completed" : "failed";
        }
      } catch {
        recoveredState = status.exitCode === 0 ? "completed" : "failed";
      }
      setAdminOperationStatus(buildAdminOperationStatus(operation, status, recoveredState, true));
      await cleanupOperationDir(entry.path);
      return;
    } catch {
      // Recovery is diagnostic only. Never read input files because they may
      // still contain the one-time FTP password.
    }
  }
  await cleanupStaleElevatedOperationDirs();
}

export async function ensureElevatedOperationRecovery(): Promise<void> {
  if (!elevatedRecoveryPromise) {
    elevatedRecoveryPromise = recoverElevatedOperationState().catch((error) => {
      safeLog("warn", {
        technicalMessage: redactDiagnosticText(error instanceof Error ? error.message : String(error))
      }, "恢复管理员操作状态失败；后续请求将重新检测");
    });
  }
  await elevatedRecoveryPromise;
}

void ensureElevatedOperationRecovery().catch(() => undefined);

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
  if ((status?.processId ?? 0) > 0 || ["process_starting", "process_started", "process_completed"].includes(status?.stage || "")) {
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
      setAdminOperationStatus(buildAdminOperationStatus(operation, status, "timed_out_waiting", false));
      const timer = setTimeout(() => { void poll(); }, 1000);
      timer.unref?.();
      return;
    }
    let lateState: ElevatedAdminOperationState = status?.exitCode === 0 ? "completed" : "failed";
    try {
      if (await waitForStableFile(operation.outputPath, 1000)) {
        const envelope = JSON.parse((await fs.readFile(operation.outputPath, "utf8")).replace(/^\uFEFF/, "")) as {
          ok?: boolean;
        };
        lateState = envelope.ok === true ? "completed" : "failed";
      }
    } catch {
      lateState = status?.exitCode === 0 ? "completed" : "failed";
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
    setAdminOperationStatus(buildAdminOperationStatus(operation, status, lateState, true));
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
    "param([string]$ScriptPath,[string]$InputPath,[string]$OutputPath,[string]$StatusPath,[string]$OperationId,[string]$Operation,[string]$ParentOperationId,[string]$ScriptName,[string]$StartedAt)",
    "$ErrorActionPreference = 'Stop'",
    "function Write-Status([string]$Stage,[int]$ExitCode = -2147483648,[int]$ProcessId = 0,[string]$Code = '',[string]$Message = '') {",
    "  $now = [DateTimeOffset]::UtcNow.ToString('o')",
    "  $state = if ($Stage -eq 'process_completed') { if ($ExitCode -eq 0) { 'completed' } else { 'failed' } } elseif ($Stage -in @('launch_failed','uac_cancelled')) { 'failed' } else { 'running' }",
    "  $value = [ordered]@{ operationId = $OperationId; operation = $Operation; scriptName = $ScriptName; stage = $Stage; state = $state; startedAt = $StartedAt; stageStartedAt = $now; lastProgressAt = $now; timestamp = $now }",
    "  if ($ParentOperationId) { $value.parentOperationId = $ParentOperationId }",
    "  if ($ExitCode -ne -2147483648) { $value.exitCode = $ExitCode }",
    "  if ($ProcessId -gt 0) { $value.processId = $ProcessId }",
    "  if ($Code) { $value.code = $Code }",
    "  if ($Message) { $value.message = $Message }",
    "  $temporaryPath = $StatusPath + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'",
    "  [IO.File]::WriteAllText($temporaryPath, ($value | ConvertTo-Json -Depth 5 -Compress), [Text.UTF8Encoding]::new($false))",
    "  if ([IO.File]::Exists($StatusPath)) { try { [IO.File]::Replace($temporaryPath, $StatusPath, $null, $true) } catch { Move-Item -LiteralPath $temporaryPath -Destination $StatusPath -Force } } else { Move-Item -LiteralPath $temporaryPath -Destination $StatusPath -Force }",
    "}",
    "try {",
    "  Write-Status -Stage 'process_starting'",
    "  $arguments = @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File', ('\"' + $ScriptPath + '\"'), '-InputPath', ('\"' + $InputPath + '\"'), '-OutputPath', ('\"' + $OutputPath + '\"'), '-StatusPath', ('\"' + $StatusPath + '\"'), '-OperationId', ('\"' + $OperationId + '\"'))",
    `  $child = Start-Process -FilePath ${powershellLiteral(windowsPowerShellExecutable())} -ArgumentList $arguments -WindowStyle Hidden -PassThru`,
    "  # The child script publishes its PID with its first real stage. Avoid a",
    "  # late process_started write that could overwrite a newer child stage.",
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
    quotedPowerShellArgumentLiteral(operationLabel),
    "'-ParentOperationId'",
    quotedPowerShellArgumentLiteral(operation.parentOperationId || ""),
    "'-ScriptName'",
    quotedPowerShellArgumentLiteral(operation.scriptName),
    "'-StartedAt'",
    quotedPowerShellArgumentLiteral(new Date(operation.requestedAt).toISOString())
  ].join(",");
  return [
    "$ErrorActionPreference = 'Stop'",
    `function Write-Status([string]$Stage,[string]$Code = '',[string]$Message = '',[int]$ProcessId = 0) { $now = [DateTimeOffset]::UtcNow.ToString('o'); $state = if ($Stage -in @('uac_cancelled','launch_failed')) { 'failed' } else { 'running' }; $value = [ordered]@{ operationId = ${powershellLiteral(operation.operationId)}; operation = ${powershellLiteral(operationLabel)}; scriptName = ${powershellLiteral(operation.scriptName)}; stage = $Stage; state = $state; startedAt = ${powershellLiteral(new Date(operation.requestedAt).toISOString())}; stageStartedAt = $now; lastProgressAt = $now; timestamp = $now }; if (${powershellLiteral(operation.parentOperationId || "")}) { $value.parentOperationId = ${powershellLiteral(operation.parentOperationId || "")} }; if ($Code) { $value.code = $Code }; if ($Message) { $value.message = $Message }; if ($ProcessId -gt 0) { $value.processId = $ProcessId }; $temporaryPath = ${powershellLiteral(operation.statusPath)} + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'; [IO.File]::WriteAllText($temporaryPath, ($value | ConvertTo-Json -Depth 5 -Compress), [Text.UTF8Encoding]::new($false)); if ([IO.File]::Exists(${powershellLiteral(operation.statusPath)})) { try { [IO.File]::Replace($temporaryPath, ${powershellLiteral(operation.statusPath)}, $null, $true) } catch { Move-Item -LiteralPath $temporaryPath -Destination ${powershellLiteral(operation.statusPath)} -Force } } else { Move-Item -LiteralPath $temporaryPath -Destination ${powershellLiteral(operation.statusPath)} -Force } }`,
    "try {",
    "  Write-Status -Stage 'uac_requested'",
    `  $arguments = @(${runnerArguments})`,
    `  $process = Start-Process -FilePath ${powershellLiteral(windowsPowerShellExecutable())} -Verb RunAs -ArgumentList $arguments -WindowStyle Hidden -PassThru`,
    "  # The elevated runner immediately publishes process_starting. Avoid a",
    "  # late uac_accepted write that could move real script progress backward.",
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
  const operation = await createOperationFiles(input, scriptName);
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
      activeElevatedOperation = operation;
      setAdminOperationStatus(buildAdminOperationStatus(operation, await readStatusFile(operation.statusPath), "running", false));
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
    if (options.elevated) {
      const terminalStatus = await readStatusFile(operation.statusPath);
      setAdminOperationStatus(buildAdminOperationStatus(operation, terminalStatus, "completed", true));
      if (activeElevatedOperation?.operationId === operation.operationId) activeElevatedOperation = null;
    }
    return parsed;
  } catch (error) {
    const serviceError = error as PowerShellServiceError;
    const status = await readStatusFile(operation.statusPath);
    const resultFileCreated = await fs.pathExists(operation.outputPath);
    if (serviceError.code === "ELEVATED_SCRIPT_TIMEOUT") {
      const uacStatus = uacStatusFor(options.elevated === true, status, serviceError.code);
      const processStarted = options.elevated === true && ((status?.processId ?? 0) > 0
        || ["uac_accepted", "process_starting", "process_started"].includes(status?.stage || ""));
      const elapsedMs = Date.now() - requestedAt;
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
          processStarted,
          processId: status?.processId,
          stageStartedAt: status?.stageStartedAt || status?.timestamp,
          lastProgressAt: status?.lastProgressAt || status?.timestamp,
          elapsedMs,
          timeoutMs,
          timeoutKind: "absolute",
          safeToRetry: !processStarted
        }
      };
      if (processStarted) {
        preserveOperationDir = true;
        if (activeElevatedOperation?.operationId === operation.operationId) activeElevatedOperation = null;
        uncertainElevatedOperation = operation;
        setAdminOperationStatus(buildAdminOperationStatus(operation, status, "timed_out_waiting", false));
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
    if (options.elevated && serviceError.code !== "ELEVATED_SCRIPT_TIMEOUT") {
      setAdminOperationStatus(buildAdminOperationStatus(operation, status, "failed", true));
      if (activeElevatedOperation?.operationId === operation.operationId) activeElevatedOperation = null;
    }
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

async function createPendingElevatedStateError(
  operation: OperationFiles
): Promise<PowerShellServiceError> {
  const status = await readStatusFile(operation.statusPath);
  const elapsedMs = Date.now() - operation.requestedAt;
  return createServiceError(
    "ELEVATED_STATE_UNKNOWN",
    "上一项管理员操作超时且仍可能在执行。请等待其结束后重新检测 IIS 状态。",
    {
      operationId: operation.operationId,
      parentOperationId: operation.parentOperationId,
      operation: status?.operation,
      scriptName: operation.scriptName,
      stage: status?.stage || "previous_operation_still_running",
      code: "ELEVATED_STATE_UNKNOWN",
      timestamp: status?.timestamp,
      systemStateUnknown: true,
      rollbackAttempted: false,
      rollbackSucceeded: null,
      details: {
        systemStateUnknown: true,
        processStarted: true,
        processId: status?.processId,
        stageStartedAt: status?.stageStartedAt || status?.timestamp,
        lastProgressAt: status?.lastProgressAt || status?.timestamp,
        elapsedMs,
        timeoutMs: PROVISIONING_TIMEOUT_MS,
        timeoutKind: "recovered_operation",
        safeToRetry: false
      }
    }
  );
}

export async function runElevatedPowerShellJsonScript<T>(
  scriptName: string,
  input: unknown = {},
  options: Omit<PowerShellJsonOptions, "elevated"> = {}
): Promise<T> {
  await ensureElevatedOperationRecovery();
  const pendingOperation = getUncertainElevatedOperation();
  if (pendingOperation) {
    throw await createPendingElevatedStateError(pendingOperation);
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
      throw await createPendingElevatedStateError(pendingAfterQueue);
    }
    return await executeJsonScript<T>(scriptName, input, { ...options, elevated: true });
  } finally {
    release();
  }
}
