import crypto from "crypto";
import { promises as nativeFs } from "fs";
import path from "path";
import fs from "fs-extra";
import { getDatabase } from "../db/database";
import { getOrCreateOperationId } from "../utils/operationContext";

const JOURNAL_VERSION = 1 as const;
const JOURNAL_DIRECTORY_NAME = ".mpw-purge-journal";
const JOURNAL_FILE_PATTERN = /^purge-([0-9a-f]{8}-[0-9a-f-]{27})\.json$/i;

export type EventPurgeRoot = "working" | "archive";
export type EventPurgePhase =
  | "prepared"
  | "staged"
  | "database_committed"
  | "restore_pending"
  | "cleanup_pending";

export interface EventPurgeTarget {
  targetPath: string;
  root: EventPurgeRoot;
}

interface EventPurgeJournalEntry {
  root: EventPurgeRoot;
  originalRelativePath: string;
  stagedRelativePath: string;
}

export interface EventPurgeJournal {
  version: typeof JOURNAL_VERSION;
  journalId: string;
  operationId: string;
  eventId: string;
  phase: "prepared";
  createdAt: string;
  entries: EventPurgeJournalEntry[];
  repositoryPath: string;
}

export interface PreparedEventPurgeJournal {
  journal: EventPurgeJournal | null;
  missingFiles: string[];
}

export interface EventPurgeCleanupResult {
  deletedFiles: string[];
  errors: string[];
}

export interface EventPurgeRecoveryIssue {
  journalId: string;
  eventId?: string;
  action: "restore" | "cleanup" | "validate";
  code: string;
}

export interface EventPurgeRecoveryResult {
  scanned: number;
  restored: number;
  cleaned: number;
  unresolved: number;
  issues: EventPurgeRecoveryIssue[];
}

interface ResolvedJournalEntry {
  originalPath: string;
  stagedPath: string;
}

function normalizeForCompare(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isStrictlyInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function journalDirectory(repositoryPath: string): string {
  return path.join(path.resolve(repositoryPath), JOURNAL_DIRECTORY_NAME);
}

function journalFilePath(repositoryPath: string, journalId: string): string {
  return path.join(journalDirectory(repositoryPath), `purge-${journalId}.json`);
}

function phaseMarkerPath(repositoryPath: string, journalId: string, phase: Exclude<EventPurgePhase, "prepared">): string {
  return path.join(journalDirectory(repositoryPath), `purge-${journalId}.${phase}`);
}

async function syncDirectoryBestEffort(directoryPath: string): Promise<void> {
  let handle: nativeFs.FileHandle | null = null;
  try {
    handle = await nativeFs.open(directoryPath, "r");
    await handle.sync();
  } catch {
    // Windows commonly refuses directory handles. The journal file itself is
    // still fsynced before its atomic rename.
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function writeNewFileAtomically(targetPath: string, content: string): Promise<void> {
  const directoryPath = path.dirname(targetPath);
  await fs.ensureDir(directoryPath);
  const tempPath = `${targetPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  let handle: nativeFs.FileHandle | null = null;
  try {
    handle = await nativeFs.open(tempPath, "wx", 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await nativeFs.rename(tempPath, targetPath);
    await syncDirectoryBestEffort(directoryPath);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await nativeFs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function writePhaseMarker(
  journal: EventPurgeJournal,
  phase: Exclude<EventPurgePhase, "prepared">
): Promise<void> {
  const targetPath = phaseMarkerPath(journal.repositoryPath, journal.journalId, phase);
  if (await fs.pathExists(targetPath)) return;
  try {
    await writeNewFileAtomically(targetPath, JSON.stringify({
      version: JOURNAL_VERSION,
      journalId: journal.journalId,
      eventId: journal.eventId,
      phase,
      updatedAt: new Date().toISOString()
    }));
  } catch (error: any) {
    if (error?.code !== "EEXIST") throw error;
  }
}

async function removeJournalArtifacts(journal: EventPurgeJournal): Promise<void> {
  const directoryPath = journalDirectory(journal.repositoryPath);
  const artifactNames = await fs.readdir(directoryPath).catch(() => [] as string[]);
  const prefix = `purge-${journal.journalId}.`;
  for (const name of artifactNames) {
    if (name.startsWith(prefix) && name !== `purge-${journal.journalId}.json`) {
      await nativeFs.rm(path.join(directoryPath, name), { force: true });
    }
  }
  // The immutable safety record is removed last. A crash before this point is
  // harmless because recovery is idempotent and SQLite remains authoritative.
  await nativeFs.rm(journalFilePath(journal.repositoryPath, journal.journalId), { force: true });
  await syncDirectoryBestEffort(directoryPath);
}

function resolveJournalEntries(journal: EventPurgeJournal): ResolvedJournalEntry[] {
  const repositoryPath = path.resolve(journal.repositoryPath);
  return journal.entries.map((entry) => {
    const allowedRoot = path.join(repositoryPath, entry.root);
    if (
      typeof entry.originalRelativePath !== "string"
      || typeof entry.stagedRelativePath !== "string"
      || path.isAbsolute(entry.originalRelativePath)
      || path.isAbsolute(entry.stagedRelativePath)
    ) {
      throw Object.assign(new Error("永久删除恢复日志包含无效路径。"), {
        code: "EVENT_PURGE_JOURNAL_INVALID_PATH"
      });
    }

    const originalPath = path.resolve(repositoryPath, entry.originalRelativePath);
    const stagedPath = path.resolve(repositoryPath, entry.stagedRelativePath);
    const stagedName = path.basename(stagedPath);
    const expectedStagedPrefix = `.${path.basename(originalPath)}.mpw-purge-`;
    const stagedId = stagedName.startsWith(expectedStagedPrefix)
      ? stagedName.slice(expectedStagedPrefix.length)
      : "";
    if (
      !isStrictlyInside(allowedRoot, originalPath)
      || !isStrictlyInside(allowedRoot, stagedPath)
      || path.dirname(originalPath) !== path.dirname(stagedPath)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stagedId)
    ) {
      throw Object.assign(new Error("永久删除恢复日志路径超出受控仓库目录。"), {
        code: "EVENT_PURGE_JOURNAL_PATH_OUTSIDE_REPOSITORY"
      });
    }
    return { originalPath, stagedPath };
  });
}

function validateJournal(
  value: unknown,
  repositoryPath: string,
  expectedJournalId: string
): EventPurgeJournal {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error("永久删除恢复日志格式无效。"), { code: "EVENT_PURGE_JOURNAL_INVALID" });
  }
  const candidate = value as Partial<EventPurgeJournal>;
  if (
    candidate.version !== JOURNAL_VERSION
    || candidate.journalId !== expectedJournalId
    || typeof candidate.operationId !== "string"
    || candidate.operationId.length < 8
    || candidate.operationId.length > 128
    || typeof candidate.eventId !== "string"
    || candidate.eventId.length < 1
    || candidate.eventId.length > 128
    || candidate.phase !== "prepared"
    || typeof candidate.createdAt !== "string"
    || !Array.isArray(candidate.entries)
    || candidate.entries.length === 0
    || candidate.entries.length > 512
    || typeof candidate.repositoryPath !== "string"
    || normalizeForCompare(candidate.repositoryPath) !== normalizeForCompare(repositoryPath)
  ) {
    throw Object.assign(new Error("永久删除恢复日志字段无效。"), { code: "EVENT_PURGE_JOURNAL_INVALID" });
  }
  const journal = candidate as EventPurgeJournal;
  if (!journal.entries.every((entry) => (
    entry
    && typeof entry === "object"
    && (entry.root === "working" || entry.root === "archive")
  ))) {
    throw Object.assign(new Error("永久删除恢复日志目录类型无效。"), { code: "EVENT_PURGE_JOURNAL_INVALID" });
  }
  resolveJournalEntries(journal);
  return journal;
}

async function makeWritableRecursive(targetPath: string): Promise<void> {
  let stat: Awaited<ReturnType<typeof nativeFs.lstat>>;
  try {
    stat = await nativeFs.lstat(targetPath);
  } catch {
    return;
  }

  if (stat.isSymbolicLink()) return;
  try {
    await nativeFs.chmod(targetPath, stat.isDirectory() ? 0o777 : 0o666);
  } catch {
    // Windows/OneDrive may keep some entries locked; rm surfaces final errors.
  }
  if (!stat.isDirectory()) return;

  let entries: string[];
  try {
    entries = await nativeFs.readdir(targetPath);
  } catch {
    return;
  }
  for (const entry of entries) {
    await makeWritableRecursive(path.join(targetPath, entry));
  }
}

export function getEventPurgeJournalDirectory(repositoryPath: string): string {
  return journalDirectory(repositoryPath);
}

export async function prepareEventPurgeJournal(
  repositoryPath: string,
  eventId: string,
  targets: EventPurgeTarget[]
): Promise<PreparedEventPurgeJournal> {
  const resolvedRepositoryPath = path.resolve(repositoryPath);
  const missingFiles: string[] = [];
  const entries: EventPurgeJournalEntry[] = [];
  const seenTargets = new Set<string>();
  const resolvedTargets: Array<{ root: EventPurgeRoot; targetPath: string }> = [];

  // Validate every requested target before writing a journal or moving a
  // single directory. This prevents a later invalid archive row from leaving
  // an earlier working directory staged.
  for (const target of targets) {
    const allowedRoot = path.join(resolvedRepositoryPath, target.root);
    const targetPath = path.resolve(target.targetPath);
    if (!target.targetPath || !isStrictlyInside(allowedRoot, targetPath)) {
      throw Object.assign(new Error("永久删除目标超出受控仓库目录。"), {
        code: "EVENT_PURGE_PATH_OUTSIDE_REPOSITORY"
      });
    }

    const normalized = normalizeForCompare(targetPath);
    if (seenTargets.has(normalized)) continue;
    seenTargets.add(normalized);
    resolvedTargets.push({ root: target.root, targetPath });
  }

  for (let index = 0; index < resolvedTargets.length; index += 1) {
    for (let candidateIndex = index + 1; candidateIndex < resolvedTargets.length; candidateIndex += 1) {
      const first = resolvedTargets[index].targetPath;
      const second = resolvedTargets[candidateIndex].targetPath;
      if (isStrictlyInside(first, second) || isStrictlyInside(second, first)) {
        throw Object.assign(new Error("永久删除目标目录不能相互嵌套。"), {
          code: "EVENT_PURGE_PATH_OVERLAP"
        });
      }
    }
  }

  for (const target of resolvedTargets) {
    const targetPath = target.targetPath;
    if (!(await fs.pathExists(targetPath))) {
      missingFiles.push(targetPath);
      continue;
    }

    let stagedPath = "";
    do {
      stagedPath = path.join(
        path.dirname(targetPath),
        `.${path.basename(targetPath)}.mpw-purge-${crypto.randomUUID()}`
      );
    } while (await fs.pathExists(stagedPath));

    entries.push({
      root: target.root,
      originalRelativePath: path.relative(resolvedRepositoryPath, targetPath),
      stagedRelativePath: path.relative(resolvedRepositoryPath, stagedPath)
    });
  }

  if (entries.length === 0) return { journal: null, missingFiles };

  const journal: EventPurgeJournal = {
    version: JOURNAL_VERSION,
    journalId: crypto.randomUUID(),
    operationId: getOrCreateOperationId(),
    eventId,
    phase: "prepared",
    createdAt: new Date().toISOString(),
    entries,
    repositoryPath: resolvedRepositoryPath
  };
  await writeNewFileAtomically(
    journalFilePath(resolvedRepositoryPath, journal.journalId),
    `${JSON.stringify(journal, null, 2)}\n`
  );
  return { journal, missingFiles };
}

export async function stageEventPurgeJournal(journal: EventPurgeJournal): Promise<void> {
  for (const entry of resolveJournalEntries(journal)) {
    const originalExists = await fs.pathExists(entry.originalPath);
    const stagedExists = await fs.pathExists(entry.stagedPath);
    if (stagedExists && !originalExists) continue;
    if (!originalExists || stagedExists) {
      throw Object.assign(new Error("永久删除目录隔离状态发生冲突。"), {
        code: "EVENT_PURGE_FILE_STAGE_CONFLICT"
      });
    }
    await nativeFs.rename(entry.originalPath, entry.stagedPath);
  }
  await writePhaseMarker(journal, "staged");
}

export async function restoreEventPurgeJournal(journal: EventPurgeJournal): Promise<string[]> {
  const errors: string[] = [];
  for (const entry of resolveJournalEntries(journal).reverse()) {
    try {
      const originalExists = await fs.pathExists(entry.originalPath);
      const stagedExists = await fs.pathExists(entry.stagedPath);
      if (originalExists && !stagedExists) continue;
      if (originalExists || !stagedExists) {
        throw new Error(originalExists ? "原路径已被重新占用" : "原路径和隔离路径均不存在");
      }
      await nativeFs.rename(entry.stagedPath, entry.originalPath);
    } catch (error: any) {
      errors.push(`${entry.originalPath}: ${error?.message || "恢复隔离目录失败"}`);
    }
  }

  if (errors.length === 0) {
    try {
      await removeJournalArtifacts(journal);
    } catch (error: any) {
      errors.push(`活动目录已恢复，但恢复日志未能清理：${error?.message || "清理失败"}`);
    }
  } else {
    await writePhaseMarker(journal, "restore_pending").catch(() => undefined);
  }
  return errors;
}

export async function markEventPurgeDatabaseCommitted(journal: EventPurgeJournal): Promise<void> {
  await writePhaseMarker(journal, "database_committed");
}

export async function cleanupEventPurgeJournal(journal: EventPurgeJournal): Promise<EventPurgeCleanupResult> {
  const deletedFiles: string[] = [];
  const errors: string[] = [];
  for (const entry of resolveJournalEntries(journal)) {
    try {
      if (await fs.pathExists(entry.stagedPath)) {
        await makeWritableRecursive(entry.stagedPath);
        await nativeFs.rm(entry.stagedPath, {
          recursive: true,
          force: true,
          maxRetries: 12,
          retryDelay: 400
        });
      }
      if (await fs.pathExists(entry.stagedPath)) {
        throw new Error("隔离目录删除后仍然存在");
      }
      deletedFiles.push(entry.originalPath);
    } catch (error: any) {
      errors.push(`${entry.originalPath}: 数据库已清理，但隔离目录删除失败；文件仍保留在 ${entry.stagedPath}（${error?.message || "删除失败"}）`);
    }
  }

  if (errors.length === 0) {
    try {
      await removeJournalArtifacts(journal);
    } catch (error: any) {
      errors.push(`活动文件已清理，但恢复日志未能删除；下次启动将重试（${error?.message || "清理失败"}）`);
    }
  } else {
    await writePhaseMarker(journal, "cleanup_pending").catch(() => undefined);
  }
  return { deletedFiles, errors };
}

async function readJournal(repositoryPath: string, filePath: string, journalId: string): Promise<EventPurgeJournal> {
  const stat = await nativeFs.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > 1024 * 1024) {
    throw Object.assign(new Error("永久删除恢复日志不是受支持的普通文件。"), {
      code: "EVENT_PURGE_JOURNAL_INVALID_FILE"
    });
  }
  const raw = await nativeFs.readFile(filePath, "utf8");
  return validateJournal(JSON.parse(raw), repositoryPath, journalId);
}

/**
 * Reconciles interrupted permanent deletion using SQLite as the commit truth:
 * an existing event restores staged paths; a missing event finishes cleanup.
 * The immutable journal is written before the first rename, so every crash
 * point is recoverable without trusting a possibly stale phase marker.
 */
export async function recoverPendingEventPurges(repositoryPath: string): Promise<EventPurgeRecoveryResult> {
  const result: EventPurgeRecoveryResult = {
    scanned: 0,
    restored: 0,
    cleaned: 0,
    unresolved: 0,
    issues: []
  };
  if (!repositoryPath.trim() || !(await fs.pathExists(repositoryPath))) return result;

  const directoryPath = journalDirectory(repositoryPath);
  if (!(await fs.pathExists(directoryPath))) return result;
  const names = await fs.readdir(directoryPath);
  for (const name of names.sort()) {
    const match = JOURNAL_FILE_PATTERN.exec(name);
    if (!match) continue;
    const journalId = match[1];
    result.scanned += 1;
    let journal: EventPurgeJournal;
    try {
      journal = await readJournal(repositoryPath, path.join(directoryPath, name), journalId);
    } catch (error: any) {
      result.unresolved += 1;
      result.issues.push({
        journalId,
        action: "validate",
        code: error?.code || "EVENT_PURGE_JOURNAL_READ_FAILED"
      });
      continue;
    }

    const eventExists = Boolean(
      getDatabase().prepare("SELECT 1 FROM events WHERE id = ? LIMIT 1").get(journal.eventId)
    );
    if (eventExists) {
      const errors = await restoreEventPurgeJournal(journal);
      if (errors.length === 0) {
        result.restored += 1;
      } else {
        result.unresolved += 1;
        result.issues.push({
          journalId,
          eventId: journal.eventId,
          action: "restore",
          code: "EVENT_PURGE_STARTUP_RESTORE_PENDING"
        });
      }
      continue;
    }

    const cleanup = await cleanupEventPurgeJournal(journal);
    if (cleanup.errors.length === 0) {
      result.cleaned += 1;
    } else {
      result.unresolved += 1;
      result.issues.push({
        journalId,
        eventId: journal.eventId,
        action: "cleanup",
        code: "EVENT_PURGE_STARTUP_CLEANUP_PENDING"
      });
    }
  }
  return result;
}
