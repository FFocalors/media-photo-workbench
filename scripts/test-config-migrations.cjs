const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const fsExtra = require("fs-extra");

const root = path.resolve(__dirname, "..");
const configModule = require(path.join(root, "dist-server", "config", "config.js"));

function containsSecretField(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsSecretField);
  return Object.entries(value).some(([key, item]) =>
    /^(?:password|newPassword|confirmPassword|oldPassword|currentPassword|secret|ftpPassword|cameraFtpPassword)$/i.test(key)
      || containsSecretField(item)
  );
}

function assertNoTemporaryConfigFiles(configDir) {
  const leftovers = fs.existsSync(configDir)
    ? fs.readdirSync(configDir).filter((name) => name.endsWith(".tmp"))
    : [];
  assert.deepEqual(leftovers, [], "atomic config writes must clean temporary files after failure");
}

function withRenameFailure(callback) {
  const originalRenameSync = fsExtra.renameSync;
  fsExtra.renameSync = () => {
    const error = new Error("simulated atomic replacement failure");
    error.code = "EACCES";
    throw error;
  };
  try {
    return callback();
  } finally {
    fsExtra.renameSync = originalRenameSync;
  }
}

function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mpw-config-migration-"));
  try {
    const legacyDocument = {
      server: { port: 3037 },
      repository: { path: "D:\\legacy-repository" },
      cameraFtpPassword: "synthetic-top-level-secret",
      cameraFtp: {
        eventId: "evt_legacy",
        username: "legacy-camera",
        password: "synthetic-legacy-secret",
        credentials: { password: "synthetic-nested-secret" }
      }
    };

    const firstMigration = configModule.migrateConfigDocument(legacyDocument);
    assert.equal(firstMigration.fromVersion, 0);
    assert.equal(firstMigration.toVersion, configModule.CONFIG_SCHEMA_VERSION);
    assert.equal(firstMigration.config.schemaVersion, configModule.CONFIG_SCHEMA_VERSION);
    assert.equal(firstMigration.config.cameraFtp.activeEventId, "evt_legacy");
    assert.equal(firstMigration.config.cameraFtp.passwordResetRequired, true);
    assert.equal(firstMigration.legacySecretRemoved, true);
    assert.equal(containsSecretField(firstMigration.config), false);

    const secondMigration = configModule.migrateConfigDocument(firstMigration.config);
    assert.deepEqual(secondMigration.config, firstMigration.config, "running config migration twice must be idempotent");
    assert.equal(secondMigration.fromVersion, configModule.CONFIG_SCHEMA_VERSION);
    assert.equal(secondMigration.changed, false);
    assert.equal(secondMigration.legacySecretRemoved, false);

    const legacyDir = path.join(tempRoot, "legacy");
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "config.json"), JSON.stringify(legacyDocument, null, 2));
    const loadedLegacy = configModule.loadConfig(legacyDir);
    const persistedLegacy = JSON.parse(fs.readFileSync(path.join(legacyDir, "config.json"), "utf8"));
    assert.equal(loadedLegacy.schemaVersion, configModule.CONFIG_SCHEMA_VERSION);
    assert.equal(loadedLegacy.cameraFtp.pendingProvisioning, null);
    assert.equal(containsSecretField(persistedLegacy), false);
    assert.deepEqual(configModule.migrateConfigDocument(persistedLegacy).config, persistedLegacy);

    const versionOneDocument = JSON.parse(JSON.stringify(firstMigration.config));
    versionOneDocument.schemaVersion = 1;
    delete versionOneDocument.cameraFtp.pendingProvisioning;
    const versionOneMigration = configModule.migrateConfigDocument(versionOneDocument);
    assert.equal(versionOneMigration.fromVersion, 1);
    assert.equal(versionOneMigration.config.cameraFtp.pendingProvisioning, null);

    const pendingSaved = configModule.saveConfig({
      cameraFtp: {
        ...loadedLegacy.cameraFtp,
        pendingProvisioning: {
          action: "setup",
          eventId: "evt_resume",
          username: "camera",
          controlPort: 21,
          passivePortStart: 50000,
          passivePortEnd: 50100,
          targetSiteName: "",
          createdAt: "2026-07-16T00:00:00.000Z",
          password: "must-never-persist",
          confirmPassword: "must-never-persist"
        }
      }
    });
    const persistedPending = JSON.parse(fs.readFileSync(path.join(legacyDir, "config.json"), "utf8"));
    assert.equal(pendingSaved.cameraFtp.pendingProvisioning.eventId, "evt_resume");
    assert.equal(containsSecretField(persistedPending), false);
    assert.equal(JSON.stringify(persistedPending).includes("must-never-persist"), false);

    const corruptedDir = path.join(tempRoot, "corrupted");
    fs.mkdirSync(corruptedDir, { recursive: true });
    const corruptedPath = path.join(corruptedDir, "config.json");
    const corruptedContents = "{\"schemaVersion\":1,\"server\":";
    fs.writeFileSync(corruptedPath, corruptedContents, "utf8");
    assert.throws(
      () => configModule.loadConfig(corruptedDir),
      (error) => error?.code === "CONFIG_PARSE_FAILED"
    );
    assert.equal(fs.readFileSync(corruptedPath, "utf8"), corruptedContents, "corrupted config must remain untouched for diagnosis");
    assert.throws(() => configModule.getConfig(), (error) => error?.code === "CONFIG_NOT_LOADED");

    const invalidLegacyDir = path.join(tempRoot, "invalid-legacy-type");
    fs.mkdirSync(invalidLegacyDir, { recursive: true });
    const invalidLegacyPath = path.join(invalidLegacyDir, "config.json");
    const invalidLegacyContents = JSON.stringify({ repository: { path: 42 } }, null, 2);
    fs.writeFileSync(invalidLegacyPath, invalidLegacyContents, "utf8");
    assert.throws(
      () => configModule.loadConfig(invalidLegacyDir),
      (error) => error?.code === "CONFIG_SCHEMA_INVALID"
    );
    assert.equal(fs.readFileSync(invalidLegacyPath, "utf8"), invalidLegacyContents);
    assert.throws(() => configModule.getConfig(), (error) => error?.code === "CONFIG_NOT_LOADED");

    const invalidCurrentDocuments = [
      {
        label: "repository_path_type",
        mutate(config) {
          config.repository.path = 42;
        }
      },
      {
        label: "camera_ftp_shape",
        mutate(config) {
          config.cameraFtp = "damaged";
        }
      }
    ];
    for (const scenario of invalidCurrentDocuments) {
      const invalidDir = path.join(tempRoot, `invalid-current-${scenario.label}`);
      fs.mkdirSync(invalidDir, { recursive: true });
      const invalidPath = path.join(invalidDir, "config.json");
      const invalidDocument = configModule.migrateConfigDocument({}).config;
      scenario.mutate(invalidDocument);
      const invalidContents = JSON.stringify(invalidDocument, null, 2);
      fs.writeFileSync(invalidPath, invalidContents, "utf8");
      assert.throws(
        () => configModule.loadConfig(invalidDir),
        (error) => error?.code === "CONFIG_SCHEMA_INVALID",
        `${scenario.label} must fail closed`
      );
      assert.equal(
        fs.readFileSync(invalidPath, "utf8"),
        invalidContents,
        `${scenario.label} must remain byte-for-byte intact`
      );
      assert.throws(() => configModule.getConfig(), (error) => error?.code === "CONFIG_NOT_LOADED");
    }

    const futureDir = path.join(tempRoot, "future");
    fs.mkdirSync(futureDir, { recursive: true });
    const futurePath = path.join(futureDir, "config.json");
    const futureContents = JSON.stringify({ schemaVersion: configModule.CONFIG_SCHEMA_VERSION + 1 });
    fs.writeFileSync(futurePath, futureContents, "utf8");
    assert.throws(
      () => configModule.loadConfig(futureDir),
      (error) => error?.code === "CONFIG_SCHEMA_UNSUPPORTED"
    );
    assert.equal(fs.readFileSync(futurePath, "utf8"), futureContents);

    const migrationFailureDir = path.join(tempRoot, "migration-write-failure");
    fs.mkdirSync(migrationFailureDir, { recursive: true });
    const migrationFailurePath = path.join(migrationFailureDir, "config.json");
    const migrationFailureContents = JSON.stringify({ repository: { path: "D:\\preserved" }, cameraFtp: { password: "synthetic-secret" } }, null, 2);
    fs.writeFileSync(migrationFailurePath, migrationFailureContents, "utf8");
    withRenameFailure(() => {
      assert.throws(
        () => configModule.loadConfig(migrationFailureDir),
        (error) => error?.code === "CONFIG_MIGRATION_WRITE_FAILED"
      );
    });
    assert.equal(fs.readFileSync(migrationFailurePath, "utf8"), migrationFailureContents, "failed migration write must preserve the existing file byte-for-byte");
    assertNoTemporaryConfigFiles(migrationFailureDir);

    const saveFailureDir = path.join(tempRoot, "save-write-failure");
    const initialConfig = configModule.loadConfig(saveFailureDir);
    const saveFailurePath = path.join(saveFailureDir, "config.json");
    const savedBeforeFailure = fs.readFileSync(saveFailurePath, "utf8");
    withRenameFailure(() => {
      assert.throws(
        () => configModule.saveConfig({ repository: { path: "D:\\must-not-commit" } }),
        (error) => error?.code === "CONFIG_WRITE_FAILED"
      );
    });
    assert.equal(fs.readFileSync(saveFailurePath, "utf8"), savedBeforeFailure, "failed save must preserve the last valid config file");
    assert.deepEqual(configModule.getConfig(), initialConfig, "failed save must preserve the last valid in-memory config");
    assertNoTemporaryConfigFiles(saveFailureDir);

    console.log(JSON.stringify({
      suite: "configMigrations",
      passed: [
        "explicit_schema_version",
        "idempotent_legacy_migration",
        "schema_v1_pending_provisioning_migration",
        "pending_provisioning_never_persists_passwords",
        "legacy_ftp_plaintext_secrets_scrubbed",
        "corrupted_config_fails_closed_without_overwrite",
        "invalid_legacy_field_types_fail_closed_without_overwrite",
        "invalid_current_schema_types_fail_closed_without_overwrite",
        "future_schema_fails_closed",
        "migration_write_failure_preserves_existing_file",
        "save_write_failure_preserves_disk_and_memory"
      ]
    }, null, 2));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main();
