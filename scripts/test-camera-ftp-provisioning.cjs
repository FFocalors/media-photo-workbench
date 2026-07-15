const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const { buildCameraFtpProvisioningPlan } = require(path.join(
  root,
  "dist-server",
  "services",
  "cameraFtpProvisioner.js"
));

const FIXED_NOW = "2026-07-14T08:00:00.000Z";
const FIXED_PLAN_ID = "plan-camera-ftp-fixture";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function merge(base, override) {
  if (!override || typeof override !== "object" || Array.isArray(override)) {
    return typeof override === "undefined" ? clone(base) : clone(override);
  }
  const output = clone(base);
  for (const [key, value] of Object.entries(override)) {
    if (
      value
      && typeof value === "object"
      && !Array.isArray(value)
      && output[key]
      && typeof output[key] === "object"
      && !Array.isArray(output[key])
    ) {
      output[key] = merge(output[key], value);
    } else {
      output[key] = clone(value);
    }
  }
  return output;
}

function healthySystem(overrides = {}) {
  const baseline = {
    platform: { isWindows: true, isWindows11: true, supported: true, version: "10.0.26100" },
    windowsFeatures: {
      ftpService: { featureName: "IIS-FTPSvc", installed: true, state: "Enabled", error: "" },
      ftpExtensibility: { featureName: "IIS-FTPExtensibility", installed: true, state: "Enabled", error: "" },
      managementTools: { featureName: "IIS-ManagementScriptingTools", installed: true, state: "Enabled", error: "" }
    },
    service: { name: "FTPSVC", exists: true, status: "Running", startType: "Auto", running: true },
    site: {
      id: 42,
      exists: true,
      name: "MediaPhotoWorkbenchFTP",
      status: "Started",
      started: true,
      physicalPath: "D:\\MediaPhotoWorkspace\\working\\event_slug\\原图\\相机FTP",
      binding: "*:21:",
      controlPort: 21,
      sslEnabled: false,
      adoptable: false,
      managed: true
    },
    binding: { value: "*:21:", host: "*", port: 21, allUnassigned: true, correct: true },
    authentication: { basicEnabled: true, anonymousEnabled: false, correct: true },
    authorization: { configured: true, username: "camera", read: true, write: true, correct: true },
    account: {
      exists: true,
      username: "camera",
      enabled: true,
      managed: true,
      description: "Media Photo Workbench Managed FTP Account",
      conflict: false
    },
    acl: {
      path: "D:\\MediaPhotoWorkspace\\working\\event_slug\\原图\\相机FTP",
      exists: true,
      read: true,
      write: true,
      correct: true,
      broadInheritedAccess: false
    },
    passivePorts: { start: 50000, end: 50100, configured: true, correct: true },
    firewall: {
      controlRule: {
        name: "Media Photo Workbench - FTP Control",
        exists: true,
        enabled: true,
        profile: "Any",
        remoteAddress: "LocalSubnet",
        correct: true
      },
      passiveRule: {
        name: "Media Photo Workbench - FTP Passive",
        exists: true,
        enabled: true,
        profile: "Any",
        remoteAddress: "LocalSubnet",
        correct: true
      },
      correct: true
    },
    port: {
      configuredPort: 21,
      listening: true,
      pid: 3600,
      processName: "svchost",
      ownedByMicrosoftFtp: true,
      conflict: false,
      reserved: false,
      reservedRange: "",
      iisSiteName: "MediaPhotoWorkbenchFTP",
      iisSiteNames: ["MediaPhotoWorkbenchFTP"],
      ownedByManagedSite: true,
      adoptable: false,
      canChangePort: true,
      availablePorts: [2021, 2022, 2023],
      recommendation: ""
    },
    conflicts: {
      portConflict: false,
      siteConflict: false,
      userConflict: false,
      pathConflict: false,
      items: []
    },
    requiresAdmin: false,
    repairable: true,
    missingItems: [],
    warnings: [],
    lastError: null
  };
  return merge(baseline, overrides);
}

function context(overrides = {}) {
  const baseline = {
    goal: "setup",
    eventId: "evt_001",
    eventExists: true,
    eventValid: true,
    eventStatus: "active",
    username: "camera",
    physicalPath: "D:\\MediaPhotoWorkspace\\working\\event_slug\\原图\\相机FTP",
    directoryExists: true,
    legacyDirectoryExists: false,
    controlPort: 21,
    passivePortStart: 50000,
    passivePortEnd: 50100,
    targetSiteName: "MediaPhotoWorkbenchFTP",
    targetSiteId: 42,
    configMatches: true,
    watcher: { running: true, unstableCount: 0, pendingCount: 0, importingCount: 0 },
    system: healthySystem(),
    now: FIXED_NOW,
    planId: FIXED_PLAN_ID
  };
  return merge(baseline, overrides);
}

function plan(overrides = {}) {
  return buildCameraFtpProvisioningPlan(context(overrides));
}

function item(result, id) {
  const found = result.items.find((entry) => entry.id === id);
  assert.ok(found, `missing plan item: ${id}`);
  return found;
}

function issue(result, code) {
  return result.issues.find((entry) => entry.code === code);
}

function assertStatuses(result, expected) {
  for (const [id, status] of Object.entries(expected)) {
    assert.equal(item(result, id).status, status, `${id} should be ${status}`);
  }
}

function mutatingItems(result) {
  return result.items.filter((entry) => ["create", "update", "repair"].includes(entry.status));
}

const tests = [];
function test(name, run) {
  tests.push({ name, run });
}

test("01 fresh environment produces a complete initialization plan", () => {
  const result = plan({
    configMatches: false,
    directoryExists: false,
    watcher: { running: false, unstableCount: 0, pendingCount: 0, importingCount: 0 },
    system: healthySystem({
      windowsFeatures: {
        ftpService: { installed: false, state: "Disabled" },
        ftpExtensibility: { installed: false, state: "Disabled" },
        managementTools: { installed: false, state: "Disabled" }
      },
      service: { exists: false, status: "notFound", startType: "unknown", running: false },
      site: { id: null, exists: false, status: "notFound", started: false, managed: false },
      binding: { value: "", allUnassigned: false, correct: false },
      authentication: { basicEnabled: false, anonymousEnabled: true, correct: false },
      authorization: { configured: false, read: false, write: false, correct: false },
      account: { exists: false, enabled: null, managed: false, conflict: false },
      acl: { exists: false, read: false, write: false, correct: false },
      passivePorts: { configured: false, correct: false },
      firewall: {
        controlRule: { exists: false, enabled: false, correct: false },
        passiveRule: { exists: false, enabled: false, correct: false },
        correct: false
      },
      port: { listening: false, pid: null, processName: "", ownedByMicrosoftFtp: false, ownedByManagedSite: false },
      missingItems: ["IIS-FTPSvc", "IIS_FTP_SITE", "FTP_ACCOUNT", "FTP_PATH"]
    })
  });
  assertStatuses(result, {
    "windows-features": "create",
    activity: "update",
    directory: "create",
    account: "create",
    site: "create",
    binding: "repair",
    authentication: "repair",
    authorization: "repair",
    acl: "repair",
    "passive-ports": "update",
    firewall: "repair",
    service: "repair",
    "site-runtime": "repair",
    watcher: "repair"
  });
  assert.equal(result.targetState, "running");
  assert.equal(result.requiresAdmin, true);
  assert.match(result.summary, /自动处理/);
});

test("02 fully configured environment is idempotent", () => {
  const result = plan();
  assert.equal(mutatingItems(result).length, 0);
  assert.equal(result.items.every((entry) => entry.status === "already_ok"), true);
  assert.equal(result.canApply, true);
  assert.match(result.summary, /当前配置已完整/);
});

test("03 missing IIS components are planned for creation", () => {
  const result = plan({
    system: healthySystem({
      windowsFeatures: {
        ftpService: { installed: false, state: "Disabled" },
        ftpExtensibility: { installed: false, state: "Disabled" },
        managementTools: { installed: false, state: "Disabled" }
      }
    })
  });
  assert.equal(item(result, "windows-features").status, "create");
  assert.match(item(result, "windows-features").summary, /启用 IIS FTP Service/);
});

test("04 a stopped managed site only needs runtime repair", () => {
  const result = plan({ system: healthySystem({ site: { status: "Stopped", started: false }, port: { listening: false } }) });
  assert.equal(item(result, "site").status, "already_ok");
  assert.equal(item(result, "site-runtime").status, "repair");
});

test("05 an incorrect binding is repaired on the managed site", () => {
  const result = plan({ system: healthySystem({ binding: { value: "*:2122:", port: 2122, allUnassigned: false, correct: false } }) });
  assert.equal(item(result, "binding").status, "repair");
  assert.match(item(result, "binding").summary, /\*:21:/);
});

test("06 an unrelated IIS site port conflict is blocked", () => {
  const conflict = {
    type: "site",
    code: "IIS_SITE_PORT_CONFLICT",
    siteName: "UnrelatedCampusFTP",
    port: 21,
    adoptable: false,
    recommendation: "请选择其他端口。"
  };
  const result = plan({
    system: healthySystem({
      conflicts: { portConflict: true, siteConflict: true, items: [conflict] },
      port: { conflict: true, iisSiteName: "UnrelatedCampusFTP", iisSiteNames: ["UnrelatedCampusFTP"] }
    })
  });
  assert.equal(item(result, "external-conflict").status, "blocked");
  assert.equal(item(result, "external-conflict").managedResource, false);
  assert.equal(result.canApply, false);
  assert.match(item(result, "external-conflict").summary, /不会修改其 binding/);
});

test("07 a non-IIS process conflict is blocked without a stop-process action", () => {
  const result = plan({
    system: healthySystem({
      conflicts: {
        portConflict: true,
        items: [{ type: "port", code: "PORT_USED_BY_OTHER_PROCESS", port: 21, pid: 7788, processName: "sshd", recommendation: "请选择其他端口。" }]
      },
      port: { conflict: true, pid: 7788, processName: "sshd", ownedByMicrosoftFtp: false }
    })
  });
  assert.equal(item(result, "external-conflict").status, "blocked");
  assert.match(item(result, "external-conflict").summary, /sshd.*PID 7788/);
  assert.doesNotMatch(JSON.stringify(result), /Stop-Process/);
  assert.equal(result.items.some((entry) => /停止外部程序|终止进程/.test(entry.label)), false);
});

test("08 a missing managed account is created", () => {
  const result = plan({ system: healthySystem({ account: { exists: false, enabled: null, managed: false, conflict: false } }) });
  assert.equal(item(result, "account").status, "create");
});

test("09 a non-managed account conflict is blocked", () => {
  const result = plan({
    system: healthySystem({
      account: { exists: true, enabled: true, managed: false, conflict: true, description: "Personal account" },
      conflicts: { userConflict: true, items: [{ type: "user", code: "FTP_ACCOUNT_CONFLICT" }] }
    })
  });
  assert.equal(item(result, "external-conflict").category, "account");
  assert.equal(item(result, "external-conflict").status, "blocked");
  assert.equal(result.items.filter((entry) => entry.id === "account").length, 0);
});

test("10 missing account ACL rights are auto-repaired", () => {
  const result = plan({ system: healthySystem({ acl: { exists: true, read: false, write: false, correct: false, broadInheritedAccess: false } }) });
  assert.equal(item(result, "acl").status, "repair");
  assert.match(item(result, "acl").summary, /SYSTEM.*Administrators/);
});

test("11 broad inherited ACL writes require explicit high-risk confirmation", () => {
  const result = plan({ system: healthySystem({ acl: { broadInheritedAccess: true } }) });
  const acl = item(result, "acl");
  assert.equal(acl.status, "user_confirmation_required");
  assert.equal(acl.risk, "high");
  assert.equal(acl.confirmationKey, "tighten-broad-acl");
  assert.ok(result.confirmations.some((entry) => entry.key === "tighten-broad-acl"));
  assert.equal(issue(result, "FTP_ACL_BROAD_WRITE").level, "user_confirmation");
});

test("12 PASV mismatch is a server-level confirmed update", () => {
  const result = plan({ system: healthySystem({ passivePorts: { start: 51000, end: 51100, configured: true, correct: false } }) });
  const passive = item(result, "passive-ports");
  assert.equal(passive.status, "update");
  assert.equal(passive.risk, "high");
  assert.equal(passive.confirmationKey, "update-global-pasv");
  assert.ok(result.confirmations.some((entry) => entry.key === "update-global-pasv" && /服务器级/.test(entry.message)));
});

test("13 mismatched managed firewall rules are repaired", () => {
  const result = plan({
    system: healthySystem({
      firewall: {
        controlRule: { exists: true, enabled: true, profile: "Any", remoteAddress: "LocalSubnet", correct: false },
        passiveRule: { exists: true, enabled: true, profile: "Any", remoteAddress: "LocalSubnet", correct: true },
        correct: false
      }
    })
  });
  assert.equal(item(result, "firewall").status, "repair");
  assert.match(item(result, "firewall").summary, /固定命名/);
});

test("14 a stopped FTPSVC is repaired", () => {
  const result = plan({ system: healthySystem({ service: { exists: true, status: "Stopped", startType: "Manual", running: false } }) });
  assert.equal(item(result, "service").status, "repair");
  assert.match(item(result, "service").summary, /Running/);
});

test("15 running FTPSVC with a stopped site still plans the site start", () => {
  const result = plan({
    system: healthySystem({
      service: { status: "Running", startType: "Auto", running: true },
      site: { status: "Stopped", started: false },
      port: { listening: false, ownedByManagedSite: false },
      lastError: { code: "IIS_FTP_SITE_START_FAILED", message: "站点未达到 Started。" }
    })
  });
  assert.equal(item(result, "service").status, "already_ok");
  assert.equal(item(result, "site-runtime").status, "repair");
});

test("16 repair goal combines configuration repair and start", () => {
  const result = plan({
    goal: "repair",
    system: healthySystem({
      site: { status: "Stopped", started: false },
      binding: { correct: false },
      authentication: { correct: false },
      authorization: { correct: false },
      acl: { correct: false },
      firewall: { correct: false },
      port: { listening: false }
    })
  });
  assert.equal(result.target, "repair");
  assertStatuses(result, {
    binding: "repair",
    authentication: "repair",
    authorization: "repair",
    acl: "repair",
    firewall: "repair",
    "site-runtime": "repair"
  });
  assert.equal(result.canApply, true);
});

test("17 the plan retains a complete immutable preflight snapshot for rollback reporting", () => {
  const system = healthySystem({ binding: { correct: false }, firewall: { correct: false } });
  const before = clone(system);
  const input = context({ system });
  const result = buildCameraFtpProvisioningPlan(input);
  assert.deepEqual(system, before, "planning must not mutate the detected Windows state");
  assert.deepEqual(result.preflight.system, before, "the plan must retain the before-state used by rollback diagnostics");
  assert.equal(mutatingItems(result).every((entry) => entry.managedResource), true);
});

test("18 repeated planning produces no duplicate resource items", () => {
  const first = plan();
  const second = plan();
  assert.deepEqual(second, first);
  assert.equal(new Set(first.items.map((entry) => entry.id)).size, first.items.length);
  assert.equal(mutatingItems(second).length, 0);
});

test("19 UAC cancellation leaves the same plan retryable", () => {
  const beforeUac = plan({ system: healthySystem({ binding: { correct: false } }) });
  assert.equal(beforeUac.requiresAdmin, true);
  assert.equal(beforeUac.canApply, true);
  const afterCancellation = plan({ system: healthySystem({ binding: { correct: false } }) });
  assert.deepEqual(afterCancellation, beforeUac, "a cancelled UAC must not consume or corrupt pure plan inputs");
});

test("20 passwords and arbitrary secrets never enter the plan", () => {
  const secret = "Never-Log-This-Password!";
  const input = context({ password: secret, confirmPassword: secret, secret });
  const result = buildCameraFtpProvisioningPlan(input);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(secret), false);
  assert.doesNotMatch(serialized, /"(?:password|confirmPassword|secret|token)"\s*:/i);
});

test("21 a custom control port synchronizes desired binding and summaries", () => {
  const result = plan({
    controlPort: 2021,
    system: healthySystem({
      site: { controlPort: 2021, binding: "*:21:" },
      binding: { value: "*:21:", port: 2021, correct: false },
      port: { configuredPort: 2021, listening: false, ownedByManagedSite: false }
    })
  });
  assert.equal(result.preflight.desired.controlPort, 2021);
  assert.equal(result.preflight.desired.binding, "*:2021:");
  assert.match(item(result, "binding").summary, /\*:2021:/);
  assert.equal(result.preflight.system.port.configuredPort, 2021);
});

test("22 unrelated IIS sites and firewall evidence remain unchanged", () => {
  const unrelated = {
    sites: [{ id: 900, name: "DoNotTouchFTP", binding: "*:2200:", physicalPath: "D:\\ExternalFTP" }],
    firewallRules: [{ internalName: "Campus-FTP-Rule", localPort: "2200", remoteAddress: "Any" }]
  };
  const system = healthySystem({ evidence: unrelated });
  const before = clone(system);
  const result = plan({ system });
  assert.deepEqual(system, before);
  assert.deepEqual(result.preflight.system.evidence, unrelated);
  assert.equal(result.items.every((entry) => entry.managedResource), true);
});

test("23 a Windows reserved port is blocked and never force-claimed", () => {
  const result = plan({
    system: healthySystem({
      port: { configuredPort: 5000, reserved: true, reservedRange: "5000-5000", conflict: true },
      conflicts: {
        portConflict: true,
        items: [{ type: "port", code: "FTP_CONTROL_PORT_RESERVED", port: 5000, recommendation: "请选择推荐端口。" }]
      }
    })
  });
  assert.equal(item(result, "external-conflict").status, "blocked");
  assert.equal(issue(result, "FTP_CONTROL_PORT_RESERVED").level, "blocked");
  assert.equal(result.canApply, false);
});

test("24 setup exposes an adoptable IIS site but cannot silently adopt it", () => {
  const conflict = { type: "site", code: "IIS_SITE_PORT_CONFLICT", siteName: "ExistingCameraFTP", port: 21, adoptable: true };
  const result = plan({ system: healthySystem({ conflicts: { portConflict: true, siteConflict: true, items: [conflict] } }) });
  const external = item(result, "external-conflict");
  assert.equal(external.status, "user_confirmation_required");
  assert.equal(external.managedResource, false);
  assert.equal(result.canApply, false);
  assert.ok(result.confirmations.some((entry) => entry.key === "adopt-site:ExistingCameraFTP"));
});

test("25 explicit adopt goal can proceed after presenting the confirmation", () => {
  const conflict = { type: "site", code: "IIS_SITE_PORT_CONFLICT", siteName: "ExistingCameraFTP", port: 21, adoptable: true };
  const result = plan({
    goal: "adopt-site",
    targetSiteName: "ExistingCameraFTP",
    targetSiteId: 77,
    system: healthySystem({ conflicts: { portConflict: true, siteConflict: true, items: [conflict] } })
  });
  assert.equal(item(result, "external-conflict").status, "user_confirmation_required");
  assert.equal(result.preflight.desired.targetSiteId, 77);
  assert.equal(result.canApply, true);
});

test("26 adopt is blocked while watcher work is in flight", () => {
  const result = plan({
    goal: "adopt-site",
    watcher: { running: true, unstableCount: 1, pendingCount: 2, importingCount: 1 }
  });
  assert.equal(item(result, "watcher").status, "blocked");
  assert.equal(issue(result, "FTP_UPLOAD_IN_PROGRESS").level, "blocked");
  assert.equal(result.canApply, false);
});

test("27 archived or missing activities are blocking preflight failures", () => {
  const archived = plan({ eventValid: false, eventStatus: "archived" });
  assert.equal(item(archived, "activity").status, "blocked");
  assert.equal(archived.canApply, false);
  const missing = plan({ eventExists: false, eventValid: false, eventStatus: "deleted" });
  assert.equal(item(missing, "activity").status, "blocked");
});

test("28 partial inspection is informational and administrator preflight remains available", () => {
  const result = plan({
    system: healthySystem({
      requiresAdmin: true,
      windowsFeatures: {
        ftpService: { installed: null, state: "unknown" },
        ftpExtensibility: { installed: null, state: "unknown" },
        managementTools: { installed: null, state: "unknown" }
      },
      site: { exists: null, started: null, managed: null },
      binding: { correct: null },
      account: { exists: null, enabled: null, managed: null, conflict: null }
    })
  });
  assert.equal(result.preflight.inspectionLevel, "partial");
  assert.equal(issue(result, "PARTIAL_INSPECTION").level, "info");
  assert.equal(item(result, "windows-features").status, "repair");
  assert.equal(result.requiresAdmin, true);
});

test("29 restart always includes a site runtime restart even when already started", () => {
  const result = plan({ goal: "restart" });
  assert.equal(item(result, "site-runtime").status, "repair");
  assert.match(item(result, "site-runtime").label, /重启/);
});

test("30 legacy ftp directories are reported but never scheduled for deletion", () => {
  const result = plan({ legacyDirectoryExists: true });
  assert.equal(issue(result, "LEGACY_FTP_DIRECTORY_PRESENT").level, "info");
  assert.doesNotMatch(JSON.stringify(result.items), /删除.*旧版|自动迁移/);
});

function main() {
  const passed = [];
  for (const entry of tests) {
    try {
      entry.run();
      passed.push(entry.name);
    } catch (error) {
      error.message = `[${entry.name}] ${error.message}`;
      throw error;
    }
  }
  console.log(JSON.stringify({
    suite: "cameraFtpProvisioning",
    fixtureOnly: true,
    realIisMutation: false,
    testCount: passed.length,
    passed
  }, null, 2));
}

main();
