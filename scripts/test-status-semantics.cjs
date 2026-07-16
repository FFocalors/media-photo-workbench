const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");

function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mpw-status-semantics-"));
  try {
    const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");
    const compile = spawnSync(process.execPath, [tsc,
      path.join(root, "src", "lib", "statusSemantics.ts"),
      "--outDir", tempRoot,
      "--target", "ES2020",
      "--module", "commonjs",
      "--moduleResolution", "node",
      "--skipLibCheck"
    ], { cwd: root, encoding: "utf8", shell: false });
    assert.equal(compile.status, 0, compile.stdout || compile.stderr);
    fs.writeFileSync(path.join(tempRoot, "package.json"), '{"type":"commonjs"}\n');
    const semantics = require(path.join(tempRoot, "statusSemantics.js"));

    for (const status of ["running", "receiving", "processing", "importing", "pending", "waiting"]) {
      const meta = semantics.getOperationalStatusSemantic(status);
      assert.equal(meta.tone, "info", `${status} must use active blue semantics`);
      assert.match(meta.badgeClass, /blue/);
    }
    assert.equal(semantics.getOperationalStatusSemantic("success").tone, "success");
    assert.match(semantics.getOperationalStatusSemantic("success").badgeClass, /emerald/);
    assert.equal(semantics.getOperationalStatusSemantic("skipped").tone, "warning");
    assert.equal(semantics.getOperationalStatusSemantic("duplicate").tone, "warning");
    assert.equal(semantics.getOperationalStatusSemantic("warning").tone, "warning");
    assert.equal(semantics.getOperationalStatusSemantic("failed").tone, "danger");

    for (const status of ["unknown", "admin_required", "stopped", "cancelled", "unexpected-future-status"]) {
      const meta = semantics.getOperationalStatusSemantic(status);
      assert.equal(meta.tone, "neutral", `${status} must not look like a failure`);
      assert.match(meta.badgeClass, /slate/);
    }

    assert.equal(semantics.getImageWorkflowStatusSemantic("rejected").tone, "neutral", "a user-classified rejected photo is not a system failure");
    assert.equal(semantics.getImageWorkflowStatusSemantic("edit").tone, "warning");
    assert.equal(semantics.getImageWorkflowStatusSemantic("edited").tone, "success");
    assert.equal(semantics.getImageWorkflowStatusSemantic("publish").tone, "info");
    assert.equal(semantics.getImageWorkflowStatusSemantic("published").tone, "success");
    assert.equal(semantics.PROVISIONING_STATUS_SEMANTICS.blocked.tone, "warning", "a blocked plan is actionable but is not an executed failure");

    const operationalKeys = ["success", "running", "receiving", "processing", "importing", "pending", "waiting", "skipped", "duplicate", "warning", "failed", "unknown", "admin_required", "stopped", "cancelled"];
    const dangerKeys = operationalKeys.filter((key) => semantics.getOperationalStatusSemantic(key).tone === "danger");
    assert.deepEqual(dangerKeys, ["failed"], "only an actual failed operational state may use red danger semantics");

    const taskCenterSource = fs.readFileSync(path.join(root, "src", "components", "tasks", "TaskCenter.tsx"), "utf8");
    const gallerySource = fs.readFileSync(path.join(root, "src", "components", "gallery", "PhotoGrid.tsx"), "utf8");
    const noticeSource = fs.readFileSync(path.join(root, "src", "components", "ui", "States.tsx"), "utf8");
    const recentFilesSource = fs.readFileSync(path.join(root, "src", "components", "import", "camera-ftp", "CameraFtpRecentFiles.tsx"), "utf8");
    const provisioningSource = fs.readFileSync(path.join(root, "src", "components", "import", "camera-ftp", "CameraFtpProvisioningFeedback.tsx"), "utf8");
    const ftpPanelSource = fs.readFileSync(path.join(root, "src", "components", "import", "CameraFtpImportPanel.tsx"), "utf8");
    for (const [name, source] of [
      ["task center", taskCenterSource],
      ["gallery", gallerySource],
      ["recent files", recentFilesSource],
      ["FTP panel", ftpPanelSource]
    ]) {
      assert.match(source, /statusSemantics/, `${name} must consume the shared status contract`);
    }
    assert.match(provisioningSource, /PROVISIONING_STATUS_SEMANTICS/, "provisioning feedback must share plan status semantics");
    assert.match(ftpPanelSource, /已停止，活动仍关联/, "a stopped FTP service must explicitly preserve the active-event association");
    assert.match(ftpPanelSource, /admin_required/, "administrator-only inspection must remain distinct from failure");
    assert.match(taskCenterSource, /ChevronRight/, "the sidebar task-center affordance must communicate right/left expansion");
    assert.match(taskCenterSource, /document\.addEventListener\("pointerdown", handlePointerDown, true\)/, "clicking outside must close the task center");
    assert.match(taskCenterSource, /createPortal\(panelNode, document\.body\)/, "the task panel must escape gallery stacking contexts");
    assert.match(gallerySource, /group relative isolate/, "photo-card overlays must remain inside the card stacking context");
    assert.match(noticeSource, /export function TransientNotice/, "operation feedback must use a dedicated transient-notice category");
    assert.match(noticeSource, /success: 5_000[\s\S]*warning: 7_000[\s\S]*danger: 9_000/, "transient notices must have tone-aware bounded durations");
    assert.match(noticeSource, /requestAnimationFrame\(\(\) => setVisible\(true\)\)/, "transient notices must animate into view after mounting");
    assert.match(noticeSource, /TRANSIENT_NOTICE_EXIT_MS/, "dismissal must leave time for the exit animation");
    assert.match(noticeSource, /prefers-reduced-motion: reduce/, "notification motion must respect reduced-motion preferences");
    assert.match(noticeSource, /clearTimeout\(dismissTimer\)/, "a replaced notice must cancel its previous dismissal timer");
    assert.match(noticeSource, /messageRef\.current === message/, "an older notice timer must not clear a newer notice");

    const transientNoticeConsumers = [
      "src/pages/host/Overview.tsx",
      "src/pages/host/Events.tsx",
      "src/pages/host/Import.tsx",
      "src/pages/host/PhotoWall.tsx",
      "src/pages/host/Retouch.tsx",
      "src/pages/host/Export.tsx",
      "src/pages/host/Archive.tsx",
      "src/pages/host/Settings.tsx",
      "src/pages/client/ClientConnect.tsx",
      "src/pages/client/ClientUpload.tsx",
      "src/pages/client/ClientRetouch.tsx",
      "src/components/import/CameraFtpImportPanel.tsx"
    ];
    for (const relativePath of transientNoticeConsumers) {
      const source = fs.readFileSync(path.join(root, relativePath), "utf8");
      assert.match(source, /<TransientNotice/, `${relativePath} must use the shared transient-notice behavior`);
    }

    console.log(JSON.stringify({
      suite: "statusSemantics",
      passed: [
        "active_states_are_blue",
        "success_is_green",
        "skipped_duplicate_warning_are_amber",
        "failed_only_is_red",
        "unknown_admin_stopped_cancelled_are_neutral",
        "gallery_workflow_is_not_failure_colored",
        "blocked_plan_is_warning",
        "shared_consumer_contracts",
        "stopped_association_is_explicit",
        "task_center_direction_outside_click_and_layering",
        "all_operation_notifications_auto_dismiss_with_motion"
      ]
    }, null, 2));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main();
