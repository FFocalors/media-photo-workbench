import path from "path";
import { getDatabase } from "../db/database";

export type CameraFtpReceiptResult = "imported" | "skipped";

export interface CameraFtpFileReceipt {
  eventId: string;
  filePath: string;
  fileSize: number;
  modifiedMs: number;
  contentHash: string;
  result: CameraFtpReceiptResult;
}

export interface CameraFtpReceiptStore {
  list(eventId: string): CameraFtpFileReceipt[];
  save(receipt: CameraFtpFileReceipt): void;
}

function pathKey(filePath: string): string {
  return path.resolve(filePath).toLowerCase();
}

/**
 * Receipt rows live for the full event lifetime. They are removed only as part
 * of an explicit permanent event purge (or by the matching FK cascade).
 */
export function deleteCameraFtpReceiptsForEvent(eventId: string): number {
  if (!eventId) return 0;
  return getDatabase()
    .prepare("DELETE FROM camera_ftp_file_receipts WHERE event_id = ?")
    .run(eventId).changes;
}

export const cameraFtpReceiptStore: CameraFtpReceiptStore = {
  list(eventId) {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT event_id, file_path, file_size, modified_ms, content_hash, result
      FROM camera_ftp_file_receipts
      WHERE event_id = ?
    `).all(eventId) as Array<{
      event_id: string;
      file_path: string;
      file_size: number;
      modified_ms: number;
      content_hash: string;
      result: CameraFtpReceiptResult;
    }>;
    const receipts = rows.map((row) => ({
      eventId: row.event_id,
      filePath: row.file_path,
      fileSize: Number(row.file_size) || 0,
      modifiedMs: Number(row.modified_ms) || 0,
      contentHash: row.content_hash || "",
      result: row.result
    }));
    const receiptsByPath = new Map(receipts.map((receipt) => [pathKey(receipt.filePath), receipt]));
    const legacyImages = db.prepare(`
      SELECT original_path, file_size, file_hash
      FROM images
      WHERE event_id = ? AND source = 'camera_ftp' AND original_path != ''
      ORDER BY created_at DESC
    `).all(eventId) as Array<{ original_path: string; file_size: number; file_hash: string }>;
    for (const image of legacyImages) {
      const key = pathKey(image.original_path);
      const existing = receiptsByPath.get(key);
      if (existing) {
        if (!existing.contentHash && image.file_hash) existing.contentHash = image.file_hash;
        continue;
      }
      const legacyReceipt: CameraFtpFileReceipt = {
        eventId,
        filePath: image.original_path,
        fileSize: Number(image.file_size) || 0,
        modifiedMs: 0,
        contentHash: image.file_hash || "",
        result: "imported"
      };
      receiptsByPath.set(key, legacyReceipt);
      receipts.push({
        ...legacyReceipt
      });
    }
    return receipts;
  },
  save(receipt) {
    getDatabase().prepare(`
      INSERT INTO camera_ftp_file_receipts (
        event_id, path_key, file_path, file_size, modified_ms, content_hash, result, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
      ON CONFLICT(event_id, path_key) DO UPDATE SET
        file_path = excluded.file_path,
        file_size = excluded.file_size,
        modified_ms = excluded.modified_ms,
        content_hash = excluded.content_hash,
        result = excluded.result,
        updated_at = excluded.updated_at
    `).run(
      receipt.eventId,
      pathKey(receipt.filePath),
      path.resolve(receipt.filePath),
      Math.max(0, Math.trunc(receipt.fileSize)),
      Math.max(0, Math.trunc(receipt.modifiedMs)),
      receipt.contentHash || "",
      receipt.result
    );
  }
};
