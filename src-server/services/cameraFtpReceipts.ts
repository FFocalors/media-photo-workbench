import path from "path";
import { getDatabase } from "../db/database";

export type CameraFtpReceiptResult = "imported" | "skipped";

export interface CameraFtpFileReceipt {
  eventId: string;
  filePath: string;
  fileSize: number;
  modifiedMs: number;
  result: CameraFtpReceiptResult;
}

export interface CameraFtpReceiptStore {
  list(eventId: string): CameraFtpFileReceipt[];
  save(receipt: CameraFtpFileReceipt): void;
}

function pathKey(filePath: string): string {
  return path.resolve(filePath).toLowerCase();
}

export const cameraFtpReceiptStore: CameraFtpReceiptStore = {
  list(eventId) {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT event_id, file_path, file_size, modified_ms, result
      FROM camera_ftp_file_receipts
      WHERE event_id = ?
    `).all(eventId) as Array<{
      event_id: string;
      file_path: string;
      file_size: number;
      modified_ms: number;
      result: CameraFtpReceiptResult;
    }>;
    const receipts = rows.map((row) => ({
      eventId: row.event_id,
      filePath: row.file_path,
      fileSize: Number(row.file_size) || 0,
      modifiedMs: Number(row.modified_ms) || 0,
      result: row.result
    }));
    const knownPaths = new Set(receipts.map((receipt) => pathKey(receipt.filePath)));
    const legacyImages = db.prepare(`
      SELECT original_path, file_size
      FROM images
      WHERE event_id = ? AND source = 'camera_ftp' AND original_path != ''
      ORDER BY created_at DESC
    `).all(eventId) as Array<{ original_path: string; file_size: number }>;
    for (const image of legacyImages) {
      const key = pathKey(image.original_path);
      if (knownPaths.has(key)) continue;
      knownPaths.add(key);
      receipts.push({
        eventId,
        filePath: image.original_path,
        fileSize: Number(image.file_size) || 0,
        modifiedMs: 0,
        result: "imported"
      });
    }
    return receipts;
  },
  save(receipt) {
    getDatabase().prepare(`
      INSERT INTO camera_ftp_file_receipts (
        event_id, path_key, file_path, file_size, modified_ms, result, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
      ON CONFLICT(event_id, path_key) DO UPDATE SET
        file_path = excluded.file_path,
        file_size = excluded.file_size,
        modified_ms = excluded.modified_ms,
        result = excluded.result,
        updated_at = excluded.updated_at
    `).run(
      receipt.eventId,
      pathKey(receipt.filePath),
      path.resolve(receipt.filePath),
      Math.max(0, Math.trunc(receipt.fileSize)),
      Math.max(0, Math.trunc(receipt.modifiedMs)),
      receipt.result
    );
  }
};
