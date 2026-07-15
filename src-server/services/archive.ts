import crypto from "crypto";
import { promises as nativeFs } from "fs";
import path from "path";
import Database from "better-sqlite3";
import fs from "fs-extra";
import { getConfig } from "../config/config";
import { getDatabase } from "../db/database";
import { emitArchiveUpdated } from "../realtime/socket";
import { getLogger } from "../utils/logger";
import { EventRow, assertEventNotActiveCameraFtp, getEventById } from "./events";
import { reserveCameraFtpEventLifecycle } from "./cameraFtpRuntimeState";
import { getEventWorkspacePaths } from "./eventWorkspace";
import { ImageRow } from "./images";
import { checkRepository } from "./repository";

type ArchiveFileType = "thumb" | "original" | "edited" | "export";

interface OperationLogRow {
  id: number;
  type: string;
  target_type: string;
  target_id: string;
  operator: string;
  device: string;
  actor_type: string;
  actor_id: string;
  actor_name: string;
  detail: string;
  created_at: string;
}

interface ExportJobRow {
  id: string;
  event_id: string;
  type: string;
  status: string;
  spec: string;
  quality: number;
  total: number;
  finished: number;
  success_count: number;
  failed_count: number;
  output_path: string;
  operator: string;
  created_at: string;
  updated_at: string;
}

export interface ArchiveMissingFile {
  imageId?: string;
  type: ArchiveFileType;
  sourcePath: string;
  reason: string;
}

export interface ArchiveFileEntry {
  image_id: string;
  type: ArchiveFileType;
  source_path: string;
  archive_path: string;
  exists: boolean;
  file_hash: string;
  size: number;
}

export interface ArchiveManifest {
  event: {
    id: string;
    name: string;
    slug: string;
    date: string;
    status: "archived";
  };
  archive: {
    created_at: string;
    archive_path: string;
    version: string;
    strategy?: string;
  };
  counts: {
    total_images: number;
    thumb_files: number;
    original_files: number;
    edited_files: number;
    export_files: number;
    missing_files: number;
  };
  files: ArchiveFileEntry[];
}

export interface ArchivePrepareResult {
  archivePath: string;
  totalImages: number;
  thumbCopied: number;
  originalCopied: number;
  editedCopied: number;
  exportCopied: number;
  missingFiles: ArchiveMissingFile[];
  manifestPath: string;
  eventDbPath: string;
}

export interface ArchiveVerifyResult {
  archivePath: string;
  verified: boolean;
  missingFiles: string[];
  mismatchedFiles: Array<{ path: string; expectedHash: string; actualHash: string }>;
  checkedAt: string;
}

export interface ArchiveCleanupResult {
  eventId: string;
  status: "archived";
  workingDir: string;
  archivePath: string;
  cleaned: boolean;
  archivedEvent: ArchivedEventRow;
}

export interface ArchiveCleanupProgress {
  total: number;
  finished: number;
  currentPath: string;
}

export interface ArchivedEventRow {
  id: string;
  event_id: string;
  event_name: string;
  event_slug: string;
  event_date: string;
  total_images: number;
  edited_images: number;
  published_images: number;
  archive_path: string;
  archived_at: string;
}

export interface ArchiveMetadataFileStatus {
  name: string;
  path: string;
  exists: boolean;
  size: number;
}

export interface ArchivedImageSummary {
  image_id: string;
  original_filename: string;
  stored_filename: string;
  rating: number;
  status: string;
  category: string;
  remark: string;
  photographer: string;
  camera_model: string;
  lens_model: string;
  shot_at: string;
  original_path: string;
  edited_path: string;
  file_hash: string;
  thumb_url: string;
  thumb_archive_path: string;
  has_thumb: boolean;
  has_original: boolean;
  has_edited: boolean;
  original_retained: boolean;
  edited_retained: boolean;
}

export interface ArchivedEventDetail {
  archivedEvent: ArchivedEventRow;
  event: ArchiveManifest["event"];
  archivePath: string;
  archivedAt: string;
  counts: ArchiveManifest["counts"];
  files: ArchiveFileEntry[];
  images: ArchivedImageSummary[];
  missingFiles: string[];
  metadataFiles: ArchiveMetadataFileStatus[];
}

export interface ArchivedEventDeleteResult {
  id: string;
  eventId: string;
  archivePath: string;
  deletedArchive: boolean;
  missingFiles: string[];
  deletedRecords: {
    archivedEvents: number;
  };
}

const ARCHIVE_VERSION = "0.8.0-dev";
const ARCHIVE_STRATEGY = "lightweight_thumbs_metadata";

function nowTimestamp(): string {
  return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

function nowIso(): string {
  return new Date().toISOString();
}

function formatDateForFilename(date = new Date()): string {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function ensureRepositoryReady(): string {
  const repoPath = getConfig().repository.path;
  const status = checkRepository(repoPath);
  if (!status.path) {
    throw { code: "REPOSITORY_NOT_READY", message: "请先在系统设置中配置仓库路径" };
  }
  if (!status.exists) {
    throw { code: "REPOSITORY_NOT_READY", message: `仓库路径不存在：${status.path}` };
  }
  if (!status.readable) {
    throw { code: "REPOSITORY_NOT_READY", message: `仓库路径不可读：${status.path}` };
  }
  if (!status.writable) {
    throw { code: "REPOSITORY_NOT_READY", message: `仓库路径不可写：${status.path}` };
  }
  return status.path;
}

function ensureArchiveableEvent(eventId: string): EventRow {
  const event = getEventById(eventId);
  if (!event) {
    throw { code: "EVENT_NOT_FOUND", message: "活动不存在" };
  }
  if (event.status === "deleted") {
    throw { code: "EVENT_NOT_ARCHIVEABLE", message: "已删除活动不能归档" };
  }
  return event;
}

function writeOperationLog(input: {
  type: string;
  eventId: string;
  detail: Record<string, unknown>;
}): void {
  getDatabase().prepare(`
    INSERT INTO operation_logs (type, target_type, target_id, operator, device, detail, created_at)
    VALUES (?, 'event', ?, '', '', ?, ?)
  `).run(
    input.type,
    input.eventId,
    JSON.stringify({ event_id: input.eventId, ...input.detail }),
    nowTimestamp()
  );
}

function getEventImages(eventId: string): ImageRow[] {
  return getDatabase().prepare(`
    SELECT * FROM images
    WHERE event_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(eventId) as ImageRow[];
}

function getEventExportJobs(eventId: string): ExportJobRow[] {
  return getDatabase().prepare(`
    SELECT * FROM export_jobs
    WHERE event_id = ?
    ORDER BY created_at ASC, id ASC
  `).all(eventId) as ExportJobRow[];
}

function getEventOperationLogs(eventId: string, imageIds: string[], exportJobIds: string[]): OperationLogRow[] {
  const db = getDatabase();
  const ids = Array.from(new Set([eventId, ...imageIds, ...exportJobIds].filter(Boolean)));
  const idWhere = ids.length > 0 ? `target_id IN (${ids.map(() => "?").join(",")})` : "0";
  const like = `%"event_id":"${eventId}"%`;
  return db.prepare(`
    SELECT * FROM operation_logs
    WHERE ${idWhere} OR detail LIKE ?
    ORDER BY created_at ASC, id ASC
  `).all(...ids, like) as OperationLogRow[];
}

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function writeCsv(filePath: string, columns: string[], rows: Record<string, unknown>[]): Promise<void> {
  const lines = [
    columns.map(csvEscape).join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","))
  ];
  await fs.outputFile(filePath, `${lines.join("\n")}\n`, "utf8");
}

async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  if (!dir || !(await fs.pathExists(dir))) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

async function uniqueFilePath(dir: string, filename: string): Promise<string> {
  const parsed = path.parse(filename || "file");
  const safeBase = (parsed.name || "file").replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").slice(0, 160);
  const ext = parsed.ext || "";
  let candidate = path.join(dir, `${safeBase}${ext}`);
  let index = 2;
  while (await fs.pathExists(candidate)) {
    candidate = path.join(dir, `${safeBase}_${index}${ext}`);
    index += 1;
  }
  return candidate;
}

async function copyImageFile(input: {
  image: ImageRow;
  type: ArchiveFileType;
  sourcePath: string;
  targetDir: string;
  filename: string;
  fileHash: string;
  missingFiles: ArchiveMissingFile[];
}): Promise<ArchiveFileEntry> {
  if (!input.sourcePath || !(await fs.pathExists(input.sourcePath))) {
    input.missingFiles.push({
      imageId: input.image.id,
      type: input.type,
      sourcePath: input.sourcePath,
      reason: "文件不存在，已跳过"
    });
    return {
      image_id: input.image.id,
      type: input.type,
      source_path: input.sourcePath,
      archive_path: "",
      exists: false,
      file_hash: input.fileHash,
      size: 0
    };
  }

  await fs.ensureDir(input.targetDir);
  const archivePath = await uniqueFilePath(input.targetDir, input.filename);
  await fs.copy(input.sourcePath, archivePath, { overwrite: false, errorOnExist: true });
  const stat = await fs.stat(archivePath);
  return {
    image_id: input.image.id,
    type: input.type,
    source_path: input.sourcePath,
    archive_path: archivePath,
    exists: true,
    file_hash: input.fileHash,
    size: stat.size
  };
}

async function copyExportTree(sourceDir: string, targetDir: string): Promise<ArchiveFileEntry[]> {
  const files = await listFilesRecursive(sourceDir);
  const entries: ArchiveFileEntry[] = [];
  for (const filePath of files) {
    const relative = path.relative(sourceDir, filePath);
    const archivePath = path.join(targetDir, relative);
    await fs.ensureDir(path.dirname(archivePath));
    await fs.copy(filePath, archivePath, { overwrite: false, errorOnExist: true });
    const stat = await fs.stat(archivePath);
    entries.push({
      image_id: "",
      type: "export",
      source_path: filePath,
      archive_path: archivePath,
      exists: true,
      file_hash: "",
      size: stat.size
    });
  }
  return entries;
}

async function createArchiveRoot(repositoryPath: string, eventSlug: string): Promise<string> {
  const archiveRoot = path.join(repositoryPath, "archive");
  const basePath = path.join(archiveRoot, eventSlug);
  if (!(await fs.pathExists(basePath))) {
    await fs.ensureDir(basePath);
    return basePath;
  }

  const timestamp = formatDateForFilename();
  let candidate = path.join(archiveRoot, `${eventSlug}_${timestamp}`);
  let index = 2;
  while (await fs.pathExists(candidate)) {
    candidate = path.join(archiveRoot, `${eventSlug}_${timestamp}_${index}`);
    index += 1;
  }
  await fs.ensureDir(candidate);
  return candidate;
}

function getArchiveDirs(archivePath: string) {
  return {
    thumbDir: path.join(archivePath, "缩略图"),
    metadataDir: path.join(archivePath, "metadata")
  };
}

async function writeEventDatabase(input: {
  eventDbPath: string;
  event: EventRow;
  images: ImageRow[];
  operationLogs: OperationLogRow[];
  exportJobs: ExportJobRow[];
}): Promise<void> {
  await fs.ensureDir(path.dirname(input.eventDbPath));
  await fs.remove(input.eventDbPath);
  const archiveDb = new Database(input.eventDbPath);
  try {
    archiveDb.pragma("journal_mode = DELETE");
    archiveDb.exec(`
      CREATE TABLE events (
        id TEXT,
        name TEXT,
        slug TEXT,
        date TEXT,
        location TEXT,
        status TEXT,
        total_images INTEGER,
        selected_images INTEGER,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE images (
        id TEXT,
        event_id TEXT,
        original_filename TEXT,
        stored_filename TEXT,
        thumb_path TEXT,
        preview_path TEXT,
        original_path TEXT,
        edited_path TEXT,
        photographer TEXT,
        camera_model TEXT,
        lens_model TEXT,
        shot_at TEXT,
        rating INTEGER,
        status TEXT,
        category TEXT,
        remark TEXT,
        source TEXT,
        uploaded_by_client_id TEXT,
        uploaded_by_name TEXT,
        uploaded_by_role TEXT,
        uploaded_at TEXT,
        file_size INTEGER,
        file_hash TEXT,
        exif_shot_at TEXT,
        width INTEGER,
        height INTEGER,
        is_deleted INTEGER,
        deleted_at TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE operation_logs (
        id INTEGER,
        type TEXT,
        target_type TEXT,
        target_id TEXT,
        operator TEXT,
        device TEXT,
        actor_type TEXT,
        actor_id TEXT,
        actor_name TEXT,
        detail TEXT,
        created_at TEXT
      );
      CREATE TABLE export_jobs (
        id TEXT,
        event_id TEXT,
        type TEXT,
        status TEXT,
        spec TEXT,
        quality INTEGER,
        total INTEGER,
        finished INTEGER,
        success_count INTEGER,
        failed_count INTEGER,
        output_path TEXT,
        operator TEXT,
        created_at TEXT,
        updated_at TEXT
      );
    `);

    archiveDb.prepare(`
      INSERT INTO events VALUES (@id, @name, @slug, @date, @location, @status, @total_images, @selected_images, @created_at, @updated_at)
    `).run(input.event);

    const insertImage = archiveDb.prepare(`
      INSERT INTO images VALUES (
        @id, @event_id, @original_filename, @stored_filename, @thumb_path, @preview_path,
        @original_path, @edited_path, @photographer, @camera_model, @lens_model, @shot_at,
        @rating, @status, @category, @remark, @source,
        @uploaded_by_client_id, @uploaded_by_name, @uploaded_by_role, @uploaded_at,
        @file_size, @file_hash, @exif_shot_at,
        @width, @height, @is_deleted, @deleted_at, @created_at, @updated_at
      )
    `);
    const insertLog = archiveDb.prepare(`
      INSERT INTO operation_logs VALUES (@id, @type, @target_type, @target_id, @operator, @device, @actor_type, @actor_id, @actor_name, @detail, @created_at)
    `);
    const insertExportJob = archiveDb.prepare(`
      INSERT INTO export_jobs VALUES (
        @id, @event_id, @type, @status, @spec, @quality, @total, @finished,
        @success_count, @failed_count, @output_path, @operator, @created_at, @updated_at
      )
    `);

    const transaction = archiveDb.transaction(() => {
      for (const image of input.images) insertImage.run(image);
      for (const log of input.operationLogs) insertLog.run(log);
      for (const job of input.exportJobs) insertExportJob.run(job);
    });
    transaction();
  } finally {
    archiveDb.close();
  }
}

async function findLatestArchivePath(repositoryPath: string, eventSlug: string): Promise<string> {
  const archiveRoot = path.join(repositoryPath, "archive");
  if (!(await fs.pathExists(archiveRoot))) {
    throw { code: "ARCHIVE_NOT_FOUND", message: "尚未生成归档" };
  }

  const candidates = (await fs.readdir(archiveRoot))
    .filter((name) => name === eventSlug || name.startsWith(`${eventSlug}_`))
    .map((name) => path.join(archiveRoot, name))
    .filter((candidate) => fs.existsSync(path.join(candidate, "metadata", "manifest.json")))
    .map((candidate) => ({ path: candidate, mtimeMs: fs.statSync(path.join(candidate, "metadata", "manifest.json")).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  if (candidates.length === 0) {
    throw { code: "ARCHIVE_NOT_FOUND", message: "尚未生成归档" };
  }
  return candidates[0].path;
}

async function resolveArchivePath(event: EventRow, archivePath?: string): Promise<string> {
  const repositoryPath = ensureRepositoryReady();
  if (archivePath && await fs.pathExists(path.join(archivePath, "metadata", "manifest.json"))) {
    return archivePath;
  }
  return findLatestArchivePath(repositoryPath, event.slug);
}

async function readManifest(archivePath: string): Promise<ArchiveManifest> {
  const manifestPath = path.join(archivePath, "metadata", "manifest.json");
  if (!(await fs.pathExists(manifestPath))) {
    throw { code: "ARCHIVE_MANIFEST_NOT_FOUND", message: "归档 manifest.json 不存在" };
  }
  return fs.readJson(manifestPath) as Promise<ArchiveManifest>;
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let current = "";
  let inQuotes = false;
  const source = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (char === "\"" && inQuotes && next === "\"") {
      current += "\"";
      index += 1;
      continue;
    }

    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(current);
      current = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(current);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  row.push(current);
  if (row.some((value) => value.length > 0)) rows.push(row);

  if (rows.length === 0) return [];
  const headers = rows[0];
  return rows.slice(1).map((values) => {
    return headers.reduce<Record<string, string>>((row, header, index) => {
      row[header] = values[index] ?? "";
      return row;
    }, {});
  });
}

async function readArchiveImagesCsv(archivedEventId: string, imagesCsvPath: string, files: ArchiveFileEntry[]): Promise<ArchivedImageSummary[]> {
  if (!(await fs.pathExists(imagesCsvPath))) return [];

  const text = await fs.readFile(imagesCsvPath, "utf8");
  const rows = parseCsv(text);
  const thumbByImageId = new Map(files.filter((file) => file.type === "thumb" && file.exists).map((file) => [file.image_id, file.archive_path]));
  const originalIds = new Set(files.filter((file) => file.type === "original" && file.exists).map((file) => file.image_id));
  const editedIds = new Set(files.filter((file) => file.type === "edited" && file.exists).map((file) => file.image_id));

  return rows.map((row) => {
    const imageId = row.image_id ?? "";
    const thumbArchivePath = row.thumb_archive_path || thumbByImageId.get(imageId) || "";
    const originalRetained = row.original_retained ? row.original_retained === "true" : originalIds.has(imageId);
    const editedRetained = row.edited_retained ? row.edited_retained === "true" : editedIds.has(imageId);
    return {
      image_id: imageId,
      original_filename: row.original_filename ?? "",
      stored_filename: row.stored_filename ?? "",
      rating: Number(row.rating || 0),
      status: row.status ?? "",
      category: row.category ?? "",
      remark: row.remark ?? "",
      photographer: row.photographer ?? "",
      camera_model: row.camera_model ?? "",
      lens_model: row.lens_model ?? "",
      shot_at: row.shot_at ?? "",
      original_path: row.original_path ?? "",
      edited_path: row.edited_path ?? "",
      file_hash: row.file_hash ?? "",
      thumb_url: imageId ? `/api/archived-events/${encodeURIComponent(archivedEventId)}/thumb/${encodeURIComponent(imageId)}` : "",
      thumb_archive_path: thumbArchivePath,
      has_thumb: Boolean(thumbArchivePath),
      has_original: originalRetained,
      has_edited: editedRetained,
      original_retained: originalRetained,
      edited_retained: editedRetained
    };
  });
}

async function getMetadataFileStatus(metadataDir: string, name: string): Promise<ArchiveMetadataFileStatus> {
  const filePath = path.join(metadataDir, name);
  if (!(await fs.pathExists(filePath))) {
    return { name, path: filePath, exists: false, size: 0 };
  }

  const stat = await fs.stat(filePath);
  return { name, path: filePath, exists: true, size: stat.size };
}

async function makeWritableRecursive(targetPath: string): Promise<void> {
  let stat: fs.Stats;
  try {
    stat = await fs.lstat(targetPath);
  } catch {
    return;
  }

  try {
    await fs.chmod(targetPath, stat.isDirectory() ? 0o777 : 0o666);
  } catch {
    // Windows/OneDrive may deny chmod for placeholders; deletion retry will surface the final error.
  }

  if (!stat.isDirectory()) return;

  let entries: string[];
  try {
    entries = await fs.readdir(targetPath);
  } catch {
    return;
  }

  for (const entry of entries) {
    await makeWritableRecursive(path.join(targetPath, entry));
  }

  try {
    await fs.chmod(targetPath, 0o777);
  } catch {
    // keep final deletion error for user-facing message
  }
}

async function chmodWritable(targetPath: string): Promise<void> {
  try {
    const stat = await fs.lstat(targetPath);
    await fs.chmod(targetPath, stat.isDirectory() ? 0o777 : 0o666);
  } catch {
    // Best effort only; deletion retry will surface the final error.
  }
}

async function collectDirectoryEntries(rootDir: string): Promise<{ files: string[]; dirs: string[] }> {
  const files: string[] = [];
  const dirs: string[] = [rootDir];

  const walk = async (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        dirs.push(entryPath);
        await walk(entryPath);
      } else {
        files.push(entryPath);
      }
    }
  };

  await walk(rootDir);
  return { files, dirs };
}

async function removePathWithRetry(targetPath: string, recursive = false): Promise<void> {
  await chmodWritable(targetPath);
  try {
    await nativeFs.rm(targetPath, {
      recursive,
      force: true,
      maxRetries: 8,
      retryDelay: 150
    });
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await chmodWritable(targetPath);
    await nativeFs.rm(targetPath, {
      recursive,
      force: true,
      maxRetries: 16,
      retryDelay: 250
    });
  }
}

async function removeWorkspaceDirectory(
  eventDir: string,
  onProgress?: (progress: ArchiveCleanupProgress) => void
): Promise<void> {
  if (!(await fs.pathExists(eventDir))) return;

  try {
    const entries = await collectDirectoryEntries(eventDir);
    const dirs = [...entries.dirs].sort((a, b) => b.length - a.length);
    const total = entries.files.length + dirs.length;
    let finished = 0;

    onProgress?.({ total, finished, currentPath: eventDir });

    for (const filePath of entries.files) {
      await removePathWithRetry(filePath);
      finished += 1;
      onProgress?.({ total, finished, currentPath: filePath });
    }

    for (const dirPath of dirs) {
      await removePathWithRetry(dirPath, true);
      finished += 1;
      onProgress?.({ total, finished, currentPath: dirPath });
    }
  } catch (err: any) {
    throw {
      code: "WORKSPACE_CLEANUP_FAILED",
      message: `工作区目录删除失败：${eventDir}。请关闭正在访问该活动目录的资源管理器、图片查看器或 OneDrive 同步后重试。原始错误：${err?.message || String(err)}`
    };
  }
}

async function removeArchiveDirectory(archivePath: string): Promise<boolean> {
  if (!archivePath || !(await fs.pathExists(archivePath))) return false;

  const removeOnce = async (maxRetries: number, retryDelay: number) => {
    await makeWritableRecursive(archivePath);
    await nativeFs.rm(archivePath, {
      recursive: true,
      force: true,
      maxRetries,
      retryDelay
    });
  };

  try {
    await removeOnce(8, 300);
  } catch (firstErr) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      await removeOnce(20, 500);
    } catch (secondErr: any) {
      const message = secondErr?.message || (firstErr instanceof Error ? firstErr.message : String(secondErr || firstErr));
      throw {
        code: "ARCHIVE_DELETE_FAILED",
        message: `归档目录删除失败：${archivePath}。请关闭正在访问该归档目录的资源管理器、图片查看器或 OneDrive 同步后重试。原始错误：${message}`
      };
    }
  }

  return true;
}

export async function prepareEventArchive(eventId: string): Promise<ArchivePrepareResult> {
  assertEventNotActiveCameraFtp(eventId);
  const releaseReservation = reserveCameraFtpEventLifecycle(eventId, "活动归档生成");
  try {
    assertEventNotActiveCameraFtp(eventId);
    return await prepareEventArchiveInternal(eventId);
  } finally {
    releaseReservation();
  }
}

async function prepareEventArchiveInternal(eventId: string): Promise<ArchivePrepareResult> {
  assertEventNotActiveCameraFtp(eventId);
  const event = ensureArchiveableEvent(eventId);
  const repositoryPath = ensureRepositoryReady();
  const archivePath = await createArchiveRoot(repositoryPath, event.slug);
  const dirs = getArchiveDirs(archivePath);
  const startedAt = nowIso();
  const missingFiles: ArchiveMissingFile[] = [];

  writeOperationLog({
    type: "archive_prepare_started",
    eventId: event.id,
    detail: { archive_path: archivePath }
  });

  try {
    for (const dir of Object.values(dirs)) {
      await fs.ensureDir(dir);
    }

    const images = getEventImages(event.id);
    const exportJobs = getEventExportJobs(event.id);
    const fileEntries: ArchiveFileEntry[] = [];

    for (const image of images) {
      fileEntries.push(await copyImageFile({
        image,
        type: "thumb",
        sourcePath: image.thumb_path,
        targetDir: dirs.thumbDir,
        filename: `${image.id}.webp`,
        fileHash: "",
        missingFiles
      }));
    }

    const thumbCopied = fileEntries.filter((entry) => entry.type === "thumb" && entry.exists).length;
    const originalCopied = 0;
    const editedCopied = 0;
    const exportCopied = 0;
    const manifest: ArchiveManifest = {
      event: {
        id: event.id,
        name: event.name,
        slug: event.slug,
        date: event.date,
        status: "archived"
      },
      archive: {
        created_at: startedAt,
        archive_path: archivePath,
        version: ARCHIVE_VERSION,
        strategy: ARCHIVE_STRATEGY
      },
      counts: {
        total_images: images.length,
        thumb_files: thumbCopied,
        original_files: originalCopied,
        edited_files: editedCopied,
        export_files: exportCopied,
        missing_files: missingFiles.length
      },
      files: fileEntries
    };

    const manifestPath = path.join(dirs.metadataDir, "manifest.json");
    const eventDbPath = path.join(dirs.metadataDir, "event.db");
    const imagesCsvPath = path.join(dirs.metadataDir, "images.csv");
    const operationLogsCsvPath = path.join(dirs.metadataDir, "operation_logs.csv");

    writeOperationLog({
      type: "archive_prepare_completed",
      eventId: event.id,
      detail: {
        archive_path: archivePath,
        total_images: images.length,
        archive_strategy: ARCHIVE_STRATEGY,
        thumb_copied: thumbCopied,
        original_copied: 0,
        edited_copied: 0,
        export_copied: 0,
        missing_files: missingFiles.length
      }
    });

    const operationLogs = getEventOperationLogs(event.id, images.map((image) => image.id), exportJobs.map((job) => job.id));
    await writeCsv(imagesCsvPath, [
      "image_id",
      "original_filename",
      "stored_filename",
      "rating",
      "status",
      "category",
      "remark",
      "photographer",
      "source",
      "uploaded_by_client_id",
      "uploaded_by_name",
      "uploaded_by_role",
      "uploaded_at",
      "camera_model",
      "lens_model",
      "shot_at",
      "thumb_archive_path",
      "original_path",
      "edited_path",
      "original_retained",
      "edited_retained",
      "file_hash"
    ], images.map((image) => {
      const thumbEntry = fileEntries.find((entry) => entry.type === "thumb" && entry.image_id === image.id);
      return {
        image_id: image.id,
        original_filename: image.original_filename,
        stored_filename: image.stored_filename,
        rating: image.rating,
        status: image.status,
        category: image.category,
        remark: image.remark,
        photographer: image.photographer,
        source: image.source,
        uploaded_by_client_id: image.uploaded_by_client_id,
        uploaded_by_name: image.uploaded_by_name,
        uploaded_by_role: image.uploaded_by_role,
        uploaded_at: image.uploaded_at,
        camera_model: image.camera_model,
        lens_model: image.lens_model,
        shot_at: image.shot_at,
        thumb_archive_path: thumbEntry?.archive_path || "",
        original_path: image.original_path,
        edited_path: image.edited_path,
        original_retained: "false",
        edited_retained: "false",
        file_hash: image.file_hash
      };
    }));
    await writeCsv(operationLogsCsvPath, [
      "id",
      "type",
      "target_type",
      "target_id",
      "operator",
      "device",
      "actor_type",
      "actor_id",
      "actor_name",
      "detail",
      "created_at"
    ], operationLogs.map((log) => ({ ...log })));
    await writeEventDatabase({ eventDbPath, event, images, operationLogs, exportJobs });
    await fs.writeJson(manifestPath, manifest, { spaces: 2 });

    return {
      archivePath,
      totalImages: images.length,
      thumbCopied,
      originalCopied,
      editedCopied,
      exportCopied,
      missingFiles,
      manifestPath,
      eventDbPath
    };
  } catch (err) {
    writeOperationLog({
      type: "archive_prepare_failed",
      eventId: event.id,
      detail: {
        archive_path: archivePath,
        error: err instanceof Error ? err.message : String(err)
      }
    });
    getLogger().error({ err, eventId: event.id, archivePath }, "生成归档失败");
    throw err;
  }
}

export async function verifyEventArchive(eventId: string, archivePath?: string): Promise<ArchiveVerifyResult> {
  const event = ensureArchiveableEvent(eventId);
  const resolvedArchivePath = await resolveArchivePath(event, archivePath);
  const manifest = await readManifest(resolvedArchivePath);
  const missingFiles: string[] = [];
  const mismatchedFiles: Array<{ path: string; expectedHash: string; actualHash: string }> = [];

  for (const entry of manifest.files) {
    if (!entry.exists) continue;
    if (!entry.archive_path || !(await fs.pathExists(entry.archive_path))) {
      missingFiles.push(entry.archive_path || entry.source_path);
      continue;
    }
    if (entry.file_hash) {
      const actualHash = await hashFile(entry.archive_path);
      if (actualHash !== entry.file_hash) {
        mismatchedFiles.push({
          path: entry.archive_path,
          expectedHash: entry.file_hash,
          actualHash
        });
      }
    }
  }

  const result: ArchiveVerifyResult = {
    archivePath: resolvedArchivePath,
    verified: missingFiles.length === 0 && mismatchedFiles.length === 0,
    missingFiles,
    mismatchedFiles,
    checkedAt: nowIso()
  };

  await fs.writeJson(path.join(resolvedArchivePath, "metadata", "verification.json"), result, { spaces: 2 });
  writeOperationLog({
    type: "archive_verified",
    eventId: event.id,
    detail: { ...result }
  });
  return result;
}

export async function cleanupEventArchive(eventId: string, input: {
  confirm?: boolean;
  archivePath?: string;
  onProgress?: (progress: ArchiveCleanupProgress) => void;
}): Promise<ArchiveCleanupResult> {
  assertEventNotActiveCameraFtp(eventId);
  const releaseReservation = reserveCameraFtpEventLifecycle(eventId, "活动归档清理");
  try {
    assertEventNotActiveCameraFtp(eventId);
    return await cleanupEventArchiveInternal(eventId, input);
  } finally {
    releaseReservation();
  }
}

async function cleanupEventArchiveInternal(eventId: string, input: {
  confirm?: boolean;
  archivePath?: string;
  onProgress?: (progress: ArchiveCleanupProgress) => void;
}): Promise<ArchiveCleanupResult> {
  if (input.confirm !== true) {
    throw { code: "ARCHIVE_CLEANUP_NOT_CONFIRMED", message: "清理工作区需要二次确认" };
  }

  assertEventNotActiveCameraFtp(eventId);
  const event = ensureArchiveableEvent(eventId);
  const repositoryPath = ensureRepositoryReady();
  const resolvedArchivePath = await resolveArchivePath(event, input.archivePath);
  const verificationPath = path.join(resolvedArchivePath, "metadata", "verification.json");
  if (!(await fs.pathExists(verificationPath))) {
    throw { code: "ARCHIVE_NOT_VERIFIED", message: "归档尚未验证，不能清理工作区" };
  }

  const verification = await fs.readJson(verificationPath) as ArchiveVerifyResult;
  if (!verification.verified) {
    throw { code: "ARCHIVE_NOT_VERIFIED", message: "归档验证未通过，不能清理工作区" };
  }

  const manifest = await readManifest(resolvedArchivePath);
  const workspace = getEventWorkspacePaths(repositoryPath, event.slug);
  const now = nowTimestamp();
  await removeWorkspaceDirectory(workspace.eventDir, input.onProgress);

  const db = getDatabase();
  db.prepare("UPDATE events SET status = 'archived', updated_at = ? WHERE id = ?").run(now, event.id);

  const editedImages = (db.prepare(`
    SELECT COUNT(*) AS count FROM images
    WHERE event_id = ? AND (status = 'edited' OR edited_path != '')
  `).get(event.id) as { count: number }).count;
  const publishedImages = (db.prepare(`
    SELECT COUNT(*) AS count FROM images
    WHERE event_id = ? AND status IN ('publish', 'published')
  `).get(event.id) as { count: number }).count;
  const archiveId = `arch_${event.id}`;

  db.prepare(`
    INSERT INTO archived_events (
      id, event_id, event_name, event_slug, event_date, total_images,
      edited_images, published_images, archive_path, archived_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      event_name = excluded.event_name,
      event_slug = excluded.event_slug,
      event_date = excluded.event_date,
      total_images = excluded.total_images,
      edited_images = excluded.edited_images,
      published_images = excluded.published_images,
      archive_path = excluded.archive_path,
      archived_at = excluded.archived_at
  `).run(
    archiveId,
    event.id,
    event.name,
    event.slug,
    event.date,
    manifest.counts.total_images,
    editedImages,
    publishedImages,
    resolvedArchivePath,
    now
  );

  writeOperationLog({
    type: "archive_workspace_cleaned",
    eventId: event.id,
    detail: {
      working_dir: workspace.eventDir,
      archive_path: resolvedArchivePath,
      main_database_records_retained: true
    }
  });

  const archivedEvent = db.prepare("SELECT * FROM archived_events WHERE id = ?").get(archiveId) as ArchivedEventRow;
  emitArchiveUpdated({
    eventId: event.id,
    archivePath: resolvedArchivePath,
    status: "archived",
    action: "archive_updated",
    updatedAt: nowIso(),
    archivedEvent
  });

  return {
    eventId: event.id,
    status: "archived",
    workingDir: workspace.eventDir,
    archivePath: resolvedArchivePath,
    cleaned: true,
    archivedEvent
  };
}

export function listArchivedEvents(): ArchivedEventRow[] {
  return getDatabase().prepare(`
    SELECT * FROM archived_events
    ORDER BY archived_at DESC
  `).all() as ArchivedEventRow[];
}

export async function getArchivedEventDetail(id: string): Promise<ArchivedEventDetail> {
  const archivedEvent = getDatabase().prepare("SELECT * FROM archived_events WHERE id = ?").get(id) as ArchivedEventRow | undefined;
  if (!archivedEvent) {
    throw { code: "ARCHIVED_EVENT_NOT_FOUND", message: "归档活动不存在" };
  }

  if (!archivedEvent.archive_path || !(await fs.pathExists(archivedEvent.archive_path))) {
    throw { code: "ARCHIVE_PATH_NOT_FOUND", message: `归档目录不存在：${archivedEvent.archive_path || "空路径"}` };
  }

  const metadataDir = path.join(archivedEvent.archive_path, "metadata");
  const manifestPath = path.join(metadataDir, "manifest.json");
  if (!(await fs.pathExists(manifestPath))) {
    throw { code: "ARCHIVE_MANIFEST_NOT_FOUND", message: "归档 manifest.json 不存在" };
  }

  const manifest = await readManifest(archivedEvent.archive_path);
  const metadataFiles = await Promise.all([
    getMetadataFileStatus(metadataDir, "manifest.json"),
    getMetadataFileStatus(metadataDir, "images.csv"),
    getMetadataFileStatus(metadataDir, "operation_logs.csv"),
    getMetadataFileStatus(metadataDir, "event.db")
  ]);

  const missingFiles: string[] = [];
  for (const entry of manifest.files) {
    if (!entry.exists) {
      missingFiles.push(entry.archive_path || entry.source_path);
      continue;
    }
    if (!entry.archive_path || !(await fs.pathExists(entry.archive_path))) {
      missingFiles.push(entry.archive_path || entry.source_path);
    }
  }

  const images = await readArchiveImagesCsv(archivedEvent.id, path.join(metadataDir, "images.csv"), manifest.files);

  return {
    archivedEvent,
    event: manifest.event,
    archivePath: archivedEvent.archive_path,
    archivedAt: archivedEvent.archived_at,
    counts: manifest.counts,
    files: manifest.files,
    images,
    missingFiles,
    metadataFiles
  };
}

export async function getArchivedEventThumbPath(id: string, imageId: string): Promise<string> {
  const archivedEvent = getDatabase().prepare("SELECT * FROM archived_events WHERE id = ?").get(id) as ArchivedEventRow | undefined;
  if (!archivedEvent) {
    throw { code: "ARCHIVED_EVENT_NOT_FOUND", message: "归档活动不存在" };
  }
  if (!archivedEvent.archive_path || !(await fs.pathExists(archivedEvent.archive_path))) {
    throw { code: "ARCHIVE_PATH_NOT_FOUND", message: `归档目录不存在：${archivedEvent.archive_path || "空路径"}` };
  }

  const manifest = await readManifest(archivedEvent.archive_path);
  const thumb = manifest.files.find((entry) => entry.type === "thumb" && entry.image_id === imageId && entry.exists);
  if (!thumb?.archive_path || !(await fs.pathExists(thumb.archive_path))) {
    throw { code: "ARCHIVE_THUMB_NOT_FOUND", message: "归档缩略图不存在" };
  }
  return thumb.archive_path;
}

export async function deleteArchivedEvent(id: string): Promise<ArchivedEventDeleteResult> {
  const archivedEvent = getDatabase().prepare("SELECT * FROM archived_events WHERE id = ?").get(id) as ArchivedEventRow | undefined;
  if (!archivedEvent) {
    throw { code: "ARCHIVED_EVENT_NOT_FOUND", message: "归档活动不存在" };
  }
  assertEventNotActiveCameraFtp(archivedEvent.event_id);
  const releaseReservation = reserveCameraFtpEventLifecycle(archivedEvent.event_id, "归档目录删除");
  try {
    assertEventNotActiveCameraFtp(archivedEvent.event_id);
    return await deleteArchivedEventInternal(id);
  } finally {
    releaseReservation();
  }
}

async function deleteArchivedEventInternal(id: string): Promise<ArchivedEventDeleteResult> {
  const db = getDatabase();
  const archivedEvent = db.prepare("SELECT * FROM archived_events WHERE id = ?").get(id) as ArchivedEventRow | undefined;
  if (!archivedEvent) {
    throw { code: "ARCHIVED_EVENT_NOT_FOUND", message: "归档活动不存在" };
  }
  assertEventNotActiveCameraFtp(archivedEvent.event_id);

  const missingFiles: string[] = [];
  const deletedArchive = await removeArchiveDirectory(archivedEvent.archive_path);
  if (!deletedArchive) {
    missingFiles.push(archivedEvent.archive_path);
  }

  writeOperationLog({
    type: "archive_deleted",
    eventId: archivedEvent.event_id,
    detail: {
      archive_id: archivedEvent.id,
      archive_path: archivedEvent.archive_path,
      archive_deleted: deletedArchive,
      missing_files: missingFiles
    }
  });

  const deletedArchivedEvents = db.prepare("DELETE FROM archived_events WHERE id = ?").run(id).changes;
  emitArchiveUpdated({
    eventId: archivedEvent.event_id,
    archivePath: archivedEvent.archive_path,
    status: "deleted",
    action: "archive_deleted",
    updatedAt: nowIso(),
    archivedEvent
  });

  return {
    id: archivedEvent.id,
    eventId: archivedEvent.event_id,
    archivePath: archivedEvent.archive_path,
    deletedArchive,
    missingFiles,
    deletedRecords: {
      archivedEvents: deletedArchivedEvents
    }
  };
}
