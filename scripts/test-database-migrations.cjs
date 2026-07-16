const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// better-sqlite3 is rebuilt for Electron in local development. Relaunch under
// Electron's matching Node ABI without opening a window or touching system state.
if (!process.versions.electron && process.env.MPW_DB_MIGRATION_ELECTRON_CHILD !== "1") {
  const electronExecutable = require("electron");
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mpw-db-migrations-"));
  const child = spawnSync(electronExecutable, [__filename], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      MPW_DB_MIGRATION_ELECTRON_CHILD: "1",
      MPW_DB_MIGRATION_TEMP_ROOT: tempRoot
    },
    stdio: "inherit"
  });
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  if (child.error) throw child.error;
  process.exitCode = child.status ?? 1;
  return;
}

const Database = require("better-sqlite3");
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist-server");
const tempRoot = process.env.MPW_DB_MIGRATION_TEMP_ROOT
  || fs.mkdtempSync(path.join(os.tmpdir(), "mpw-db-migrations-"));

function createLegacyDatabase(dbPath, { omitStoredFilename = false } = {}) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  const storedFilenameColumn = omitStoredFilename
    ? ""
    : "stored_filename TEXT NOT NULL,";
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      date TEXT NOT NULL,
      location TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      total_images INTEGER NOT NULL DEFAULT 0,
      selected_images INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE TABLE images (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      ${storedFilenameColumn}
      thumb_path TEXT NOT NULL DEFAULT '',
      preview_path TEXT NOT NULL DEFAULT '',
      original_path TEXT NOT NULL DEFAULT '',
      edited_path TEXT NOT NULL DEFAULT '',
      photographer TEXT NOT NULL DEFAULT '',
      camera_model TEXT NOT NULL DEFAULT '',
      lens_model TEXT NOT NULL DEFAULT '',
      shot_at TEXT NOT NULL DEFAULT '',
      rating INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'unselected',
      category TEXT NOT NULL DEFAULT '',
      remark TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'host_import'
        CHECK (source IN ('host_import', 'client_upload', 'remote_import', 'manual_import')),
      file_size INTEGER NOT NULL DEFAULT 0,
      file_hash TEXT NOT NULL DEFAULT '',
      exif_shot_at TEXT NOT NULL DEFAULT '',
      width INTEGER NOT NULL DEFAULT 0,
      height INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );
    CREATE TABLE operation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      target_type TEXT NOT NULL DEFAULT '',
      target_id TEXT NOT NULL DEFAULT '',
      operator TEXT NOT NULL DEFAULT '',
      device TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE TABLE camera_ftp_file_receipts (
      event_id TEXT NOT NULL,
      path_key TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      modified_ms INTEGER NOT NULL DEFAULT 0,
      result TEXT NOT NULL CHECK (result IN ('imported', 'skipped')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      PRIMARY KEY (event_id, path_key),
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );
  `);
  db.prepare(`
    INSERT INTO events (id, name, slug, date, status)
    VALUES ('evt_legacy', 'Legacy Event', 'legacy-event', '2026-07-16', 'active')
  `).run();
  if (omitStoredFilename) {
    db.prepare(`
      INSERT INTO images (id, event_id, original_filename, source, file_size, file_hash)
      VALUES ('img_legacy', 'evt_legacy', 'legacy.jpg', 'host_import', 42, 'legacy-hash')
    `).run();
  } else {
    db.prepare(`
      INSERT INTO images (id, event_id, original_filename, stored_filename, source, file_size, file_hash)
      VALUES ('img_legacy', 'evt_legacy', 'legacy.jpg', 'legacy-stored.jpg', 'host_import', 42, 'legacy-hash')
    `).run();
  }
  const receiptPath = path.join(path.dirname(dbPath), "working", "legacy.jpg");
  db.prepare(`
    INSERT INTO camera_ftp_file_receipts (
      event_id, path_key, file_path, file_size, modified_ms, result
    ) VALUES ('evt_legacy', ?, ?, 42, 1000, 'skipped')
  `).run(path.resolve(receiptPath).toLowerCase(), path.resolve(receiptPath));
  db.close();
}

function listBackups(dbPath) {
  const backupDir = path.join(path.dirname(dbPath), ".migration-backups");
  if (!fs.existsSync(backupDir)) return [];
  return fs.readdirSync(backupDir)
    .filter((name) => name.endsWith(".db"))
    .map((name) => path.join(backupDir, name));
}

function migrationIds(db) {
  return db.prepare("SELECT id FROM schema_migrations ORDER BY id").all().map((row) => row.id);
}

function main() {
  const databaseModule = require(path.join(dist, "db", "database.js"));
  const receiptModule = require(path.join(dist, "services", "cameraFtpReceipts.js"));
  let db = null;

  try {
    const legacyPath = path.join(tempRoot, "legacy", "app.db");
    createLegacyDatabase(legacyPath);
    db = databaseModule.initDatabase(legacyPath);

    assert.deepEqual(migrationIds(db), [...databaseModule.SCHEMA_MIGRATION_IDS]);
    assert.match(
      db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'images'").get().sql,
      /'camera_ftp'/
    );
    assert.equal(db.prepare("SELECT stored_filename FROM images WHERE id = 'img_legacy'").get().stored_filename, "legacy-stored.jpg");
    assert.equal(db.prepare("SELECT content_hash FROM camera_ftp_file_receipts WHERE event_id = 'evt_legacy'").get().content_hash, "");

    const firstBackups = listBackups(legacyPath);
    assert.equal(firstBackups.length, 1, "a real table rebuild must create exactly one pre-migration backup");
    const migrationRecord = db.prepare("SELECT backup_path FROM schema_migrations WHERE id = ?")
      .get(databaseModule.SCHEMA_MIGRATION_IDS[1]);
    assert.equal(path.resolve(migrationRecord.backup_path), path.resolve(firstBackups[0]));
    const backupDb = new Database(firstBackups[0], { readonly: true, fileMustExist: true });
    assert.equal(backupDb.pragma("quick_check", { simple: true }), "ok");
    assert.equal(backupDb.prepare("SELECT original_filename FROM images WHERE id = 'img_legacy'").get().original_filename, "legacy.jpg");
    backupDb.close();

    assert.throws(
      () => databaseModule.initDatabase(path.join(tempRoot, "second-live", "app.db")),
      (error) => error?.code === "DATABASE_ALREADY_INITIALIZED"
    );
    assert.equal(databaseModule.getDatabase(), db, "a prohibited second initialization must not replace the live connection");
    assert.equal(path.resolve(databaseModule.getCurrentDatabasePath()), path.resolve(legacyPath));

    databaseModule.closeDatabase();
    db = databaseModule.initDatabase(legacyPath);
    assert.deepEqual(migrationIds(db), [...databaseModule.SCHEMA_MIGRATION_IDS]);
    assert.equal(listBackups(legacyPath).length, 1, "reopening an already migrated database must not create another backup");
    assert.equal(receiptModule.cameraFtpReceiptStore.list("evt_legacy").length, 1, "receipts must survive restart");

    db.prepare("UPDATE events SET status = 'deleted' WHERE id = 'evt_legacy'").run();
    databaseModule.closeDatabase();
    db = databaseModule.initDatabase(legacyPath);
    assert.equal(receiptModule.cameraFtpReceiptStore.list("evt_legacy").length, 1, "logical deletion must preserve event receipts");
    assert.equal(receiptModule.deleteCameraFtpReceiptsForEvent("evt_legacy"), 1);
    assert.equal(receiptModule.cameraFtpReceiptStore.list("evt_legacy").length, 0, "explicit permanent-purge cleanup must remove matching receipts");

    db.prepare("INSERT INTO events (id, name, slug, date, status) VALUES ('evt_cascade', 'Cascade', 'cascade', '2026-07-16', 'deleted')").run();
    receiptModule.cameraFtpReceiptStore.save({
      eventId: "evt_cascade",
      filePath: path.join(tempRoot, "cascade.jpg"),
      fileSize: 1,
      modifiedMs: 1,
      contentHash: "hash",
      result: "imported"
    });
    db.prepare("DELETE FROM events WHERE id = 'evt_cascade'").run();
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM camera_ftp_file_receipts WHERE event_id = 'evt_cascade'").get().count, 0, "FK cascade must remain a second cleanup guard");

    databaseModule.closeDatabase();
    db = null;

    const freshPath = path.join(tempRoot, "fresh", "app.db");
    db = databaseModule.initDatabase(freshPath);
    assert.deepEqual(migrationIds(db), [...databaseModule.SCHEMA_MIGRATION_IDS]);
    assert.equal(listBackups(freshPath).length, 0, "a fresh current-schema database must not create a migration backup");
    databaseModule.closeDatabase();
    db = null;

    const driftPath = path.join(tempRoot, "schema-drift", "app.db");
    fs.mkdirSync(path.dirname(driftPath), { recursive: true });
    fs.copyFileSync(freshPath, driftPath);
    const driftDb = new Database(driftPath);
    driftDb.exec("ALTER TABLE camera_ftp_file_receipts DROP COLUMN content_hash");
    driftDb.close();
    assert.throws(
      () => databaseModule.initDatabase(driftPath),
      (error) => error?.code === "DATABASE_MIGRATION_FAILED"
        && error?.migrationId === databaseModule.SCHEMA_MIGRATION_IDS[2]
        && /账本与实际 Schema 不一致/.test(error?.message || ""),
      "an applied migration ledger must never hide a missing required column"
    );
    assert.equal(databaseModule.getCurrentDatabasePath(), "");

    const brokenPath = path.join(tempRoot, "broken", "app.db");
    createLegacyDatabase(brokenPath, { omitStoredFilename: true });
    let failure = null;
    try {
      databaseModule.initDatabase(brokenPath);
    } catch (error) {
      failure = error;
    }
    assert.ok(failure, "a failed table rebuild must reject initialization");
    assert.equal(failure.code, "DATABASE_MIGRATION_FAILED");
    assert.equal(failure.migrationId, databaseModule.SCHEMA_MIGRATION_IDS[1]);
    assert.ok(failure.backupPath && fs.existsSync(failure.backupPath), "the controlled backup must remain available after a failed rebuild");
    assert.throws(() => databaseModule.getDatabase(), /数据库未初始化/);

    const brokenDb = new Database(brokenPath, { readonly: true, fileMustExist: true });
    const brokenImagesSql = brokenDb.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'images'").get().sql;
    assert.doesNotMatch(brokenImagesSql, /'camera_ftp'/, "the failed rebuild transaction must leave the source table intact");
    assert.equal(brokenDb.prepare("SELECT COUNT(*) AS count FROM images WHERE id = 'img_legacy'").get().count, 1);
    assert.equal(brokenDb.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE id = ?")
      .get(databaseModule.SCHEMA_MIGRATION_IDS[1]).count, 0, "a failed migration must never be recorded as applied");
    brokenDb.close();

    const failedBackupDb = new Database(failure.backupPath, { readonly: true, fileMustExist: true });
    assert.equal(failedBackupDb.pragma("quick_check", { simple: true }), "ok");
    assert.equal(failedBackupDb.prepare("SELECT COUNT(*) AS count FROM images WHERE id = 'img_legacy'").get().count, 1);
    failedBackupDb.close();

    for (let attempt = 0; attempt < databaseModule.PRE_MIGRATION_BACKUP_RETENTION + 2; attempt += 1) {
      assert.throws(
        () => databaseModule.initDatabase(brokenPath),
        (error) => error?.code === "DATABASE_MIGRATION_FAILED"
      );
    }
    const retainedFailedBackups = listBackups(brokenPath);
    assert.equal(
      retainedFailedBackups.length,
      databaseModule.PRE_MIGRATION_BACKUP_RETENTION,
      "repeated failed startup attempts must keep a bounded set of verified recovery backups"
    );
    for (const backupPath of retainedFailedBackups) {
      const retainedBackupDb = new Database(backupPath, { readonly: true, fileMustExist: true });
      assert.equal(retainedBackupDb.pragma("quick_check", { simple: true }), "ok");
      retainedBackupDb.close();
    }

    console.log(JSON.stringify({
      suite: "databaseMigrations",
      passed: [
        "explicit_migration_ledger",
        "idempotent_reopen",
        "high_risk_backup",
        "duplicate_initialization_is_prohibited",
        "migration_failure_is_fail_closed",
        "migration_ledger_schema_drift_is_fail_closed",
        "failed_rebuild_rolls_back",
        "failed_migration_backups_have_bounded_retention",
        "receipt_restart_and_event_lifetime",
        "explicit_and_cascade_receipt_cleanup"
      ]
    }, null, 2));
  } finally {
    try {
      databaseModule.closeDatabase();
    } catch {
      // Best-effort test cleanup.
    }
    if (!process.env.MPW_DB_MIGRATION_TEMP_ROOT) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

main();
