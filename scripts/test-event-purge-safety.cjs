const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// better-sqlite3 is rebuilt for Electron in local development. Relaunch under
// Electron's matching Node ABI without opening a window or touching IIS.
if (!process.versions.electron && process.env.MPW_EVENT_PURGE_ELECTRON_CHILD !== "1") {
  const electronExecutable = require("electron");
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mpw-event-purge-"));
  const child = spawnSync(electronExecutable, [__filename], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      MPW_EVENT_PURGE_ELECTRON_CHILD: "1",
      MPW_EVENT_PURGE_TEMP_ROOT: tempRoot
    },
    stdio: "inherit"
  });
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  if (child.error) throw child.error;
  process.exitCode = child.status ?? 1;
  return;
}

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist-server");
const tempRoot = process.env.MPW_EVENT_PURGE_TEMP_ROOT
  || fs.mkdtempSync(path.join(os.tmpdir(), "mpw-event-purge-"));

function stagedEntries(parentPath, slug) {
  if (!fs.existsSync(parentPath)) return [];
  return fs.readdirSync(parentPath)
    .filter((name) => name.startsWith(`.${slug}.mpw-purge-`))
    .map((name) => path.join(parentPath, name));
}

function journalFiles(repositoryPath) {
  const journalPath = path.join(repositoryPath, ".mpw-purge-journal");
  if (!fs.existsSync(journalPath)) return [];
  return fs.readdirSync(journalPath)
    .filter((name) => /^purge-[0-9a-f-]+\.json$/i.test(name))
    .map((name) => path.join(journalPath, name));
}

function seedEvent(db, repositoryPath, {
  id,
  slug,
  archivePath = "",
  createArchive = false
}) {
  db.prepare(`
    INSERT INTO events (id, name, slug, date, status)
    VALUES (?, ?, ?, '2026-07-16', 'deleted')
  `).run(id, `Purge ${slug}`, slug);
  db.prepare(`
    INSERT INTO images (id, event_id, original_filename, stored_filename, source)
    VALUES (?, ?, 'sentinel.jpg', 'sentinel.jpg', 'camera_ftp')
  `).run(`img_${id}`, id);
  const workingPath = path.join(repositoryPath, "working", slug);
  fs.mkdirSync(workingPath, { recursive: true });
  fs.writeFileSync(path.join(workingPath, "sentinel.jpg"), `working:${id}`);
  db.prepare(`
    INSERT INTO camera_ftp_file_receipts (
      event_id, path_key, file_path, file_size, modified_ms, content_hash, result
    ) VALUES (?, ?, ?, 1, 1, 'hash', 'imported')
  `).run(id, path.resolve(path.join(workingPath, "sentinel.jpg")).toLowerCase(), path.join(workingPath, "sentinel.jpg"));

  let resolvedArchivePath = archivePath;
  if (createArchive) {
    resolvedArchivePath = archivePath || path.join(repositoryPath, "archive", slug);
    fs.mkdirSync(resolvedArchivePath, { recursive: true });
    fs.writeFileSync(path.join(resolvedArchivePath, "archive-sentinel.txt"), `archive:${id}`);
  }
  if (resolvedArchivePath) {
    db.prepare(`
      INSERT INTO archived_events (
        id, event_id, event_name, event_slug, event_date, archive_path
      ) VALUES (?, ?, ?, ?, '2026-07-16', ?)
    `).run(`archive_${id}`, id, `Purge ${slug}`, slug, resolvedArchivePath);
  }
  return { workingPath, archivePath: resolvedArchivePath };
}

function count(db, table, column, value) {
  return db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`).get(value).count;
}

async function main() {
  const database = require(path.join(dist, "db", "database.js"));
  const config = require(path.join(dist, "config", "config.js"));
  const events = require(path.join(dist, "services", "events.js"));
  const purgeJournal = require(path.join(dist, "services", "eventPurgeJournal.js"));
  const repositoryPath = path.join(tempRoot, "repository");
  const configPath = path.join(tempRoot, "config");
  const dbPath = path.join(tempRoot, "data", "app.db");
  fs.mkdirSync(path.join(repositoryPath, "working"), { recursive: true });
  fs.mkdirSync(path.join(repositoryPath, "archive"), { recursive: true });
  config.loadConfig(configPath);
  config.saveConfig({ repository: { path: repositoryPath } });
  let db = database.initDatabase(dbPath);

  try {
    const outsidePath = path.join(tempRoot, "outside-archive");
    fs.mkdirSync(outsidePath, { recursive: true });
    fs.writeFileSync(path.join(outsidePath, "outside-sentinel.txt"), "must-survive");
    const outsideCase = seedEvent(db, repositoryPath, {
      id: "evt_path_outside",
      slug: "path-outside",
      archivePath: outsidePath
    });
    await assert.rejects(
      () => events.purgeEvent("evt_path_outside", { includeArchive: true }),
      (error) => error?.code === "EVENT_PURGE_PATH_OUTSIDE_REPOSITORY"
    );
    assert.equal(fs.existsSync(path.join(outsideCase.workingPath, "sentinel.jpg")), true);
    assert.equal(fs.existsSync(path.join(outsidePath, "outside-sentinel.txt")), true);
    assert.deepEqual(stagedEntries(path.join(repositoryPath, "working"), "path-outside"), []);
    assert.equal(count(db, "events", "id", "evt_path_outside"), 1);
    assert.equal(count(db, "images", "event_id", "evt_path_outside"), 1);
    assert.equal(count(db, "camera_ftp_file_receipts", "event_id", "evt_path_outside"), 1);
    assert.deepEqual(journalFiles(repositoryPath), []);
    const outsideFailure = db.prepare(`
      SELECT detail FROM operation_logs
      WHERE type = 'event_purge_failed' AND target_id = ?
      ORDER BY id DESC LIMIT 1
    `).get("evt_path_outside");
    assert.equal(JSON.parse(outsideFailure.detail).stage, "stage_files");

    const dbFailureCase = seedEvent(db, repositoryPath, {
      id: "evt_db_failure",
      slug: "db-failure",
      createArchive: true
    });
    db.exec(`
      CREATE TRIGGER inject_event_purge_failure
      BEFORE DELETE ON events
      WHEN OLD.id = 'evt_db_failure'
      BEGIN
        SELECT RAISE(ABORT, 'INJECTED_PURGE_DB_FAILURE');
      END;
    `);
    await assert.rejects(
      () => events.purgeEvent("evt_db_failure", { includeArchive: true }),
      (error) => error?.code === "EVENT_PURGE_DATABASE_FAILED"
    );
    db.exec("DROP TRIGGER inject_event_purge_failure");
    assert.equal(fs.existsSync(path.join(dbFailureCase.workingPath, "sentinel.jpg")), true);
    assert.equal(fs.existsSync(path.join(dbFailureCase.archivePath, "archive-sentinel.txt")), true);
    assert.deepEqual(stagedEntries(path.join(repositoryPath, "working"), "db-failure"), []);
    assert.deepEqual(stagedEntries(path.join(repositoryPath, "archive"), "db-failure"), []);
    assert.equal(count(db, "events", "id", "evt_db_failure"), 1);
    assert.equal(count(db, "images", "event_id", "evt_db_failure"), 1);
    assert.equal(count(db, "camera_ftp_file_receipts", "event_id", "evt_db_failure"), 1);
    assert.equal(count(db, "archived_events", "event_id", "evt_db_failure"), 1);
    assert.equal(count(db, "operation_logs", "type", "event_purged"), 0);
    assert.deepEqual(journalFiles(repositoryPath), []);
    const databaseFailure = db.prepare(`
      SELECT detail FROM operation_logs
      WHERE type = 'event_purge_failed' AND target_id = ?
      ORDER BY id DESC LIMIT 1
    `).get("evt_db_failure");
    assert.equal(JSON.parse(databaseFailure.detail).stage, "delete_database_records");

    const cleanupCase = seedEvent(db, repositoryPath, {
      id: "evt_cleanup_failure",
      slug: "cleanup-failure"
    });
    const nativePromises = require("node:fs").promises;
    const originalRm = nativePromises.rm;
    nativePromises.rm = async (targetPath, options) => {
      if (String(targetPath).includes(".cleanup-failure.mpw-purge-")) {
        throw new Error("INJECTED_POST_COMMIT_CLEANUP_FAILURE");
      }
      return originalRm(targetPath, options);
    };
    let cleanupResult;
    try {
      cleanupResult = await events.purgeEvent("evt_cleanup_failure", { includeArchive: false });
    } finally {
      nativePromises.rm = originalRm;
    }
    assert.equal(count(db, "events", "id", "evt_cleanup_failure"), 0);
    assert.equal(count(db, "images", "event_id", "evt_cleanup_failure"), 0);
    assert.equal(count(db, "camera_ftp_file_receipts", "event_id", "evt_cleanup_failure"), 0);
    assert.equal(fs.existsSync(cleanupCase.workingPath), false);
    const cleanupStagedPaths = stagedEntries(path.join(repositoryPath, "working"), "cleanup-failure");
    assert.equal(cleanupStagedPaths.length, 1);
    assert.equal(fs.existsSync(path.join(cleanupStagedPaths[0], "sentinel.jpg")), true);
    assert.equal(cleanupResult.deletedFiles.includes(cleanupCase.workingPath), false);
    assert.equal(cleanupResult.errors.length, 1);
    assert.match(cleanupResult.errors[0], /数据库已清理/);
    assert.ok(cleanupResult.errors[0].includes(cleanupStagedPaths[0]));
    assert.equal(journalFiles(repositoryPath).length, 1);

    database.closeDatabase();
    db = database.initDatabase(dbPath);
    const cleanupRecovery = await purgeJournal.recoverPendingEventPurges(repositoryPath);
    assert.deepEqual(cleanupRecovery, {
      scanned: 1,
      restored: 0,
      cleaned: 1,
      unresolved: 0,
      issues: []
    });
    assert.equal(fs.existsSync(cleanupStagedPaths[0]), false);
    assert.deepEqual(journalFiles(repositoryPath), []);

    const preCommitCase = seedEvent(db, repositoryPath, {
      id: "evt_precommit_restart",
      slug: "precommit-restart",
      createArchive: true
    });
    const preCommitPrepared = await purgeJournal.prepareEventPurgeJournal(
      repositoryPath,
      "evt_precommit_restart",
      [
        { targetPath: preCommitCase.workingPath, root: "working" },
        { targetPath: preCommitCase.archivePath, root: "archive" }
      ]
    );
    assert.ok(preCommitPrepared.journal);
    await purgeJournal.stageEventPurgeJournal(preCommitPrepared.journal);
    assert.equal(fs.existsSync(preCommitCase.workingPath), false);
    assert.equal(fs.existsSync(preCommitCase.archivePath), false);
    assert.equal(journalFiles(repositoryPath).length, 1);

    database.closeDatabase();
    db = database.initDatabase(dbPath);
    const preCommitRecovery = await purgeJournal.recoverPendingEventPurges(repositoryPath);
    assert.deepEqual(preCommitRecovery, {
      scanned: 1,
      restored: 1,
      cleaned: 0,
      unresolved: 0,
      issues: []
    });
    assert.equal(count(db, "events", "id", "evt_precommit_restart"), 1);
    assert.equal(fs.existsSync(path.join(preCommitCase.workingPath, "sentinel.jpg")), true);
    assert.equal(fs.existsSync(path.join(preCommitCase.archivePath, "archive-sentinel.txt")), true);
    assert.deepEqual(stagedEntries(path.join(repositoryPath, "working"), "precommit-restart"), []);
    assert.deepEqual(stagedEntries(path.join(repositoryPath, "archive"), "precommit-restart"), []);
    assert.deepEqual(journalFiles(repositoryPath), []);

    const postCommitCase = seedEvent(db, repositoryPath, {
      id: "evt_postcommit_restart",
      slug: "postcommit-restart",
      createArchive: true
    });
    const postCommitPrepared = await purgeJournal.prepareEventPurgeJournal(
      repositoryPath,
      "evt_postcommit_restart",
      [
        { targetPath: postCommitCase.workingPath, root: "working" },
        { targetPath: postCommitCase.archivePath, root: "archive" }
      ]
    );
    assert.ok(postCommitPrepared.journal);
    await purgeJournal.stageEventPurgeJournal(postCommitPrepared.journal);
    db.transaction(() => {
      db.prepare("DELETE FROM camera_ftp_file_receipts WHERE event_id = ?").run("evt_postcommit_restart");
      db.prepare("DELETE FROM images WHERE event_id = ?").run("evt_postcommit_restart");
      db.prepare("DELETE FROM archived_events WHERE event_id = ?").run("evt_postcommit_restart");
      db.prepare("DELETE FROM events WHERE id = ?").run("evt_postcommit_restart");
    })();
    assert.equal(journalFiles(repositoryPath).length, 1);

    database.closeDatabase();
    db = database.initDatabase(dbPath);
    const postCommitRecovery = await purgeJournal.recoverPendingEventPurges(repositoryPath);
    assert.deepEqual(postCommitRecovery, {
      scanned: 1,
      restored: 0,
      cleaned: 1,
      unresolved: 0,
      issues: []
    });
    assert.equal(count(db, "events", "id", "evt_postcommit_restart"), 0);
    assert.equal(fs.existsSync(postCommitCase.workingPath), false);
    assert.equal(fs.existsSync(postCommitCase.archivePath), false);
    assert.deepEqual(stagedEntries(path.join(repositoryPath, "working"), "postcommit-restart"), []);
    assert.deepEqual(stagedEntries(path.join(repositoryPath, "archive"), "postcommit-restart"), []);
    assert.deepEqual(journalFiles(repositoryPath), []);

    console.log(JSON.stringify({
      suite: "eventPurgeSafety",
      passed: [
        "outside_repository_path_is_rejected_and_staged_paths_are_restored",
        "database_failure_restores_files_and_records",
        "post_commit_cleanup_failure_returns_partial_success_with_files_preserved",
        "post_commit_cleanup_is_retried_after_database_restart",
        "precommit_restart_restores_staged_working_and_archive_paths",
        "postcommit_restart_removes_staged_working_and_archive_paths"
      ]
    }, null, 2));
  } finally {
    database.closeDatabase();
    if (!process.env.MPW_EVENT_PURGE_TEMP_ROOT) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
