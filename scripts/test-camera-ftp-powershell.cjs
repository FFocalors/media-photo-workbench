const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const scriptsDirectory = path.join(root, "scripts", "windows");

function main() {
  if (process.platform !== "win32") {
    console.log(JSON.stringify({ suite: "cameraFtpPowerShell", skipped: "non_windows" }, null, 2));
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mpw-iis-powershell-"));
  try {
    const harnessPath = path.join(tempRoot, "validate-iis-ftp-protocol.ps1");
    const outputPath = path.join(tempRoot, "structured result 中文.json");
    const harness = String.raw`
param([string]$ScriptsDirectory,[string]$OutputPath)
$ErrorActionPreference = 'Stop'
$parserFailures = @()
foreach ($file in @(Get-ChildItem -LiteralPath $ScriptsDirectory -Filter '*.ps1' -File | Sort-Object Name)) {
  $tokens = $null
  $errors = $null
  [void][Management.Automation.Language.Parser]::ParseFile($file.FullName,[ref]$tokens,[ref]$errors)
  foreach ($parseError in @($errors)) { $parserFailures += [ordered]@{ file = $file.Name; message = $parseError.Message } }
}
. (Join-Path $ScriptsDirectory 'iis-ftp-common.ps1')
$firewallEnabledParameterType = (Get-Command Set-NetFirewallRule).Parameters['Enabled'].ParameterType
$enumNormalization = [ordered]@{
  sslControlZero = ConvertTo-MpwFtpSslPolicyName -Value '0' -Channel control
  sslDataZero = ConvertTo-MpwFtpSslPolicyName -Value '0' -Channel data
  accessTypeZero = ConvertTo-MpwFtpAuthorizationAccessTypeName -Value '0'
  permissionsThree = ConvertTo-MpwFtpAuthorizationPermissionsName -Value '3'
  permissionsNamed = ConvertTo-MpwFtpAuthorizationPermissionsName -Value 'Read, Write'
  firewallEnabledTrue = [string][Management.Automation.LanguagePrimitives]::ConvertTo('True', $firewallEnabledParameterType)
}
$failure = [ordered]@{
  code = 'FIREWALL_CONFIG_FAILED'
  message = 'Firewall failed.'
  technicalMessage = 'Policy denied the change.'
  exceptionType = 'System.UnauthorizedAccessException'
  command = 'Set-NetFirewallRule'
}
Write-MpwScriptResult -OutputPath $OutputPath -Action 'repair' -Ok $false -Stage 'configure_firewall' -SiteName '测试站点' -ErrorObject $failure -Warnings @('warning') -RollbackAttempted $true -RollbackSucceeded $true
$envelope = Get-Content -LiteralPath $OutputPath -Raw | ConvertFrom-Json
$cloudPlaceholder = [pscustomobject]@{ Attributes = ([IO.FileAttributes]::Directory -bor [IO.FileAttributes]::ReparsePoint); LinkType = $null; Target = $null }
$junction = [pscustomobject]@{ Attributes = ([IO.FileAttributes]::Directory -bor [IO.FileAttributes]::ReparsePoint); LinkType = 'Junction'; Target = 'D:\target' }
$normalDirectory = [pscustomobject]@{ Attributes = [IO.FileAttributes]::Directory; LinkType = $null; Target = $null }
$script:fakeFtpRuntime = @{ state = 'Stopped'; serverAutoStart = $false; startCalls = 0; stopCalls = 0 }
$fakeStartInstance = [pscustomobject]@{}
$fakeStartInstance | Add-Member -MemberType ScriptMethod -Name Execute -Value { $script:fakeFtpRuntime.state = 'Started'; $script:fakeFtpRuntime.startCalls++ }
$fakeStopInstance = [pscustomobject]@{}
$fakeStopInstance | Add-Member -MemberType ScriptMethod -Name Execute -Value { $script:fakeFtpRuntime.state = 'Stopped'; $script:fakeFtpRuntime.stopCalls++ }
$fakeStartMethod = [pscustomobject]@{}
$fakeStartMethod | Add-Member -MemberType ScriptMethod -Name CreateInstance -Value { return $script:fakeStartInstance }
$fakeStopMethod = [pscustomobject]@{}
$fakeStopMethod | Add-Member -MemberType ScriptMethod -Name CreateInstance -Value { return $script:fakeStopInstance }
$script:fakeStartInstance = $fakeStartInstance
$script:fakeStopInstance = $fakeStopInstance
$script:fakeFtpRuntime.Methods = @{ Start = $fakeStartMethod; Stop = $fakeStopMethod }
$fakeSite = [pscustomobject]@{ Name = 'MPW Runtime Test' }
$fakeSite | Add-Member -MemberType ScriptMethod -Name GetChildElement -Value { param($name) return $script:fakeFtpRuntime }
Start-MpwSite -Site $fakeSite
$stateAfterStart = Get-MpwFtpSiteRuntimeState -Site $fakeSite
Stop-MpwSite -Site $fakeSite
$stateAfterStop = Get-MpwFtpSiteRuntimeState -Site $fakeSite
$script:fakeFtpRuntime.state = 1
$numericStateAfterStart = Get-MpwFtpSiteRuntimeState -Site $fakeSite
$script:fakeFtpRuntime.state = 3
$numericStateAfterStop = Get-MpwFtpSiteRuntimeState -Site $fakeSite
$fakeFailInstance = [pscustomobject]@{}
$fakeFailInstance | Add-Member -MemberType ScriptMethod -Name Execute -Value { throw [Runtime.InteropServices.COMException]::new('Synthetic FTP runtime failure.', -2147024864) }
$fakeFailMethod = [pscustomobject]@{}
$fakeFailMethod | Add-Member -MemberType ScriptMethod -Name CreateInstance -Value { return $script:fakeFailInstance }
$script:fakeFailInstance = $fakeFailInstance
$script:fakeFtpRuntime.Methods.Start = $fakeFailMethod
$ftpRuntimeFailure = $null
try { Start-MpwSite -Site $fakeSite } catch { $ftpRuntimeFailure = ConvertTo-MpwSafeException -ErrorRecord $_ }
function Get-MpwIisFtpStartDiagnostics { throw [MissingMemberException]::new('Synthetic StrictMode diagnostics failure.') }
$ftpRuntimeDiagnosticsFailure = $null
try { Start-MpwSite -Site $fakeSite } catch { $ftpRuntimeDiagnosticsFailure = ConvertTo-MpwSafeException -ErrorRecord $_ }
$fakePartialSite = [pscustomobject]@{}
$fakePartialSite | Add-Member -MemberType ScriptMethod -Name GetChildElement -Value { param($name) return $script:fakeFtpRuntime }
$ftpRuntimePartialSiteFailure = $null
try { Start-MpwSite -Site $fakePartialSite } catch { $ftpRuntimePartialSiteFailure = ConvertTo-MpwSafeException -ErrorRecord $_ }
function Wait-MpwFtpSiteRuntimeState { param($Site,$ExpectedState,$TimeoutMilliseconds) return 'Stopped' }
$fakeTimeoutInstance = [pscustomobject]@{}
$fakeTimeoutInstance | Add-Member -MemberType ScriptMethod -Name Execute -Value { return $null }
$fakeTimeoutMethod = [pscustomobject]@{}
$fakeTimeoutMethod | Add-Member -MemberType ScriptMethod -Name CreateInstance -Value { return $script:fakeTimeoutInstance }
$script:fakeTimeoutInstance = $fakeTimeoutInstance
$script:fakeFtpRuntime.Methods.Start = $fakeTimeoutMethod
$script:fakeFtpRuntime.state = 'Stopped'
$ftpRuntimeTimeoutFailure = $null
try { Start-MpwSite -Site $fakePartialSite } catch { $ftpRuntimeTimeoutFailure = ConvertTo-MpwSafeException -ErrorRecord $_ }
$script:featureEnableCalls = [Collections.Generic.List[string]]::new()
function Get-WindowsOptionalFeature {
  [CmdletBinding()]
  param([switch]$Online,[string]$FeatureName)
  [pscustomobject]@{ FeatureName = $FeatureName; State = 'Disabled' }
}
function Enable-WindowsOptionalFeature {
  [CmdletBinding()]
  param([switch]$Online,[string]$FeatureName,[switch]$All,[switch]$NoRestart)
  [void]$script:featureEnableCalls.Add($FeatureName)
  [pscustomobject]@{ RestartNeeded = $true }
}
$featureRestart = Enable-MpwRequiredWindowsFeatures
$serviceRollbackStop = Get-MpwFtpServiceRollbackDecision -Snapshot ([ordered]@{ exists = $true; running = $false; startType = 'Manual' }) -CurrentStatus ([ordered]@{ exists = $true; running = $true; startType = 'Auto' }) -OtherStartedSites @()
$serviceRollbackSkip = Get-MpwFtpServiceRollbackDecision -Snapshot ([ordered]@{ exists = $true; running = $false; startType = 'Auto' }) -CurrentStatus ([ordered]@{ exists = $true; running = $true; startType = 'Auto' }) -OtherStartedSites @([ordered]@{ id = 99; name = 'Unrelated FTP'; state = 'Started' })
$serviceRollbackStart = Get-MpwFtpServiceRollbackDecision -Snapshot ([ordered]@{ exists = $true; running = $true; startType = 'Disabled' }) -CurrentStatus ([ordered]@{ exists = $true; running = $false; startType = 'Manual' }) -OtherStartedSites @()
$firewallRollbackSnapshot = [ordered]@{
  internalName = 'MediaPhotoWorkbench-FTP-Control'
  displayName = 'Media Photo Workbench - FTP Control'
  enabled = $true
  direction = 'Inbound'
  action = 'Allow'
  profile = 'Any'
  protocol = 'TCP'
  localPort = @('21')
  remotePort = @('Any')
  localAddress = @('Any')
  remoteAddress = @('LocalSubnet')
}
$script:firewallRollbackEnabledValue = $null
$script:firewallRollbackEnabledType = $null
function Set-NetFirewallRule {
  param($Name,$NewDisplayName,$Enabled,$Direction,$Action,$Profile,$Protocol,$LocalPort,$RemotePort,$LocalAddress,$RemoteAddress,$ErrorAction)
  $script:firewallRollbackEnabledValue = [string]$Enabled
  $script:firewallRollbackEnabledType = [string]$Enabled.GetType().FullName
  return [pscustomobject]@{ Name = $Name }
}
function Get-NetFirewallRule { param($Name,$ErrorAction) return [pscustomobject]@{ Name = $Name } }
function Get-MpwFirewallRuleSnapshot { param($Rule) return $firewallRollbackSnapshot }
$firewallRollbackResult = Restore-MpwFirewallRuleSnapshot -Snapshot $firewallRollbackSnapshot
$aclRights = [ordered]@{
  read = Test-MpwWriteCapableFileSystemRights -Rights ([Security.AccessControl.FileSystemRights]::Read)
  readAndExecute = Test-MpwWriteCapableFileSystemRights -Rights ([Security.AccessControl.FileSystemRights]::ReadAndExecute)
  write = Test-MpwWriteCapableFileSystemRights -Rights ([Security.AccessControl.FileSystemRights]::Write)
  modify = Test-MpwWriteCapableFileSystemRights -Rights ([Security.AccessControl.FileSystemRights]::Modify)
  fullControl = Test-MpwWriteCapableFileSystemRights -Rights ([Security.AccessControl.FileSystemRights]::FullControl)
}
$nonCanonicalAcl = [Security.AccessControl.DirectorySecurity]::new()
$nonCanonicalAcl.SetSecurityDescriptorSddlForm(
  'D:P(A;OICI;0x1301bf;;;BU)(D;CI;DT;;;WD)',
  [Security.AccessControl.AccessControlSections]::Access
)
$canonicalAcl = ConvertTo-MpwCanonicalDirectorySecurity -Acl $nonCanonicalAcl
$aclFixturePath = Join-Path ([IO.Path]::GetDirectoryName($OutputPath)) 'acl-snapshot-fixture'
[void][IO.Directory]::CreateDirectory($aclFixturePath)
$aclSnapshotFixture = Get-MpwDirectoryAclSnapshot -PhysicalPath $aclFixturePath
$fixtureAcl = [IO.Directory]::GetAccessControl($aclFixturePath)
$fixtureRule = [Security.AccessControl.FileSystemAccessRule]::new(
  [Security.Principal.SecurityIdentifier]::new('S-1-1-0'),
  [Security.AccessControl.FileSystemRights]::ReadAndExecute,
  [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit,
  [Security.AccessControl.PropagationFlags]::None,
  [Security.AccessControl.AccessControlType]::Allow
)
[void]$fixtureAcl.AddAccessRule($fixtureRule)
[IO.Directory]::SetAccessControl($aclFixturePath, $fixtureAcl)
$aclRestoreFixture = Restore-MpwDirectoryAclSnapshot -PhysicalPath $aclFixturePath -Snapshot $aclSnapshotFixture
$aclRestoredFixture = Get-MpwDirectoryAclSnapshot -PhysicalPath $aclFixturePath
$nonCanonicalFixturePath = Join-Path ([IO.Path]::GetDirectoryName($OutputPath)) 'acl-noncanonical-rollback-fixture'
[void][IO.Directory]::CreateDirectory($nonCanonicalFixturePath)
$nonCanonicalFixtureOriginal = Get-MpwDirectoryAclSnapshot -PhysicalPath $nonCanonicalFixturePath
$fixtureCurrentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$nonCanonicalFixtureAcl = [Security.AccessControl.DirectorySecurity]::new()
$nonCanonicalFixtureAcl.SetSecurityDescriptorSddlForm(
  "D:P(A;OICI;FA;;;$fixtureCurrentSid)(D;CI;DT;;;WD)",
  [Security.AccessControl.AccessControlSections]::Access
)
[IO.Directory]::SetAccessControl($nonCanonicalFixturePath, $nonCanonicalFixtureAcl)
$nonCanonicalFixtureSnapshot = Get-MpwDirectoryAclSnapshot -PhysicalPath $nonCanonicalFixturePath
$nonCanonicalFixtureRebuilt = ConvertTo-MpwCanonicalDirectorySecurity -Acl ([IO.Directory]::GetAccessControl($nonCanonicalFixturePath))
[IO.Directory]::SetAccessControl($nonCanonicalFixturePath, $nonCanonicalFixtureRebuilt)
$nonCanonicalFixtureRestore = Restore-MpwDirectoryAclSnapshot -PhysicalPath $nonCanonicalFixturePath -Snapshot $nonCanonicalFixtureSnapshot
$nonCanonicalFixtureRestored = Get-MpwDirectoryAclSnapshot -PhysicalPath $nonCanonicalFixturePath
Restore-MpwDirectoryAclSnapshot -PhysicalPath $nonCanonicalFixturePath -Snapshot $nonCanonicalFixtureOriginal | Out-Null
$protocolOutputPath = $OutputPath
. (Join-Path $ScriptsDirectory 'iis-ftp-setup.ps1')
$script:setupOpenManagerCalls = 0
$script:setupMockInput = [pscustomobject]@{
  action = 'setup'
  password = 'temporary-test-value'
  targetSiteName = ''
  confirmAdoption = $false
  allowAclTightening = $false
}
function Read-MpwJsonInput { param($Path,[switch]$DeleteAfterRead) return $script:setupMockInput }
function Assert-MpwAllowedInputProperties { param($InputObject,$AllowedProperties) }
function Assert-MpwAction { param($InputObject,$AllowedActions) return 'setup' }
function Assert-MpwAdministrator { }
function Get-MpwNormalizedOptions {
  param($InputObject,[switch]$RequirePath)
  return [pscustomobject]@{
    SiteName = 'MediaPhotoWorkbenchFTP'
    ManagedSiteId = 0
    Username = 'camera'
    PhysicalPath = (Join-Path ([IO.Path]::GetDirectoryName($protocolOutputPath)) 'restart-gate-receive')
    ControlPort = 21
    PassivePortStart = 50000
    PassivePortEnd = 50100
    Binding = '*:21:'
    FirewallControlRuleName = 'Media Photo Workbench FTP Control'
    FirewallPassiveRuleName = 'Media Photo Workbench FTP Passive'
    AllowLegacyFirewallRuleUpdate = $false
  }
}
function Assert-MpwPhysicalPath { param($PhysicalPath,[switch]$AllowMissing,[switch]$Create) return [string]$PhysicalPath }
function Assert-MpwPassword { param($Password) return [string]$Password }
function Get-MpwLocalAccountStatus { param($Username) return [ordered]@{ exists = $true; enabled = $true; conflict = $false; managed = $true } }
function Get-MpwPortStatus { param($Port,$PassiveStart,$PassiveEnd) return [ordered]@{ port = $Port; reserved = $false; usedByOtherProcess = $false; availablePorts = @(2122, 2221) } }
function Assert-MpwFirewallRuleUpdatesAllowed { param($Options) }
function Open-MpwServerManager { $script:setupOpenManagerCalls++; Throw-MpwFailure -Code 'IIS_FTP_NOT_INSTALLED' -Message 'Synthetic preflight-only missing feature.' }
function Get-MpwWindowsFeaturesStatus { return @([ordered]@{ featureName = 'IIS-FTPSvc'; state = 'Disabled'; requiresAdmin = $false }) }
function Get-MpwFtpServiceStatus { return [ordered]@{ exists = $true; running = $false; state = 'Stopped'; startType = 'Manual' } }
function Get-MpwDirectoryAclStatus { param($PhysicalPath,$Username) return [ordered]@{ exists = $false; readWriteAllowed = $false; broadInheritedAccess = $false; rules = @() } }
function Enable-MpwRequiredWindowsFeatures { return [ordered]@{ enabledFeatures = @('IIS-FTPSvc'); processedFeatures = @('IIS-FTPSvc'); remainingFeatures = @('IIS-FTPExtensibility'); restartRequired = $true; restartFeature = 'IIS-FTPSvc' } }
$setupRestartOutputPath = Join-Path ([IO.Path]::GetDirectoryName($protocolOutputPath)) 'restart gate result.json'
$setupRestartExitCode = Invoke-MpwIisFtpSetup -InputPath (Join-Path ([IO.Path]::GetDirectoryName($protocolOutputPath)) 'synthetic-input.json') -OutputPath $setupRestartOutputPath
$setupRestartRaw = Get-Content -LiteralPath $setupRestartOutputPath -Raw
$setupRestartEnvelope = $setupRestartRaw | ConvertFrom-Json
$result = [ordered]@{
  parserFailures = @($parserFailures)
  enumNormalization = $enumNormalization
  envelope = $envelope
  reparseSafety = [ordered]@{
    cloudPlaceholderUnsafe = Test-MpwUnsafeReparsePoint -Item $cloudPlaceholder
    junctionUnsafe = Test-MpwUnsafeReparsePoint -Item $junction
    normalDirectoryUnsafe = Test-MpwUnsafeReparsePoint -Item $normalDirectory
  }
  ftpRuntime = [ordered]@{
    stateAfterStart = $stateAfterStart
    stateAfterStop = $stateAfterStop
    numericStateAfterStart = $numericStateAfterStart
    numericStateAfterStop = $numericStateAfterStop
    startCalls = $script:fakeFtpRuntime.startCalls
    stopCalls = $script:fakeFtpRuntime.stopCalls
    failureCode = [string]$ftpRuntimeFailure.code
    failureCommand = [string]$ftpRuntimeFailure.command
    failureHresult = [string]$ftpRuntimeFailure.details.hresult
    failureServiceState = [string]$ftpRuntimeFailure.details.ftpServiceState
    diagnosticFailureCode = [string]$ftpRuntimeDiagnosticsFailure.code
    diagnosticFailureHresult = [string]$ftpRuntimeDiagnosticsFailure.details.hresult
    diagnosticCollectionError = [string]$ftpRuntimeDiagnosticsFailure.details.diagnostics.diagnosticsError
    partialSiteFailureCode = [string]$ftpRuntimePartialSiteFailure.code
    partialSiteFailureHresult = [string]$ftpRuntimePartialSiteFailure.details.hresult
    timeoutFailureCode = [string]$ftpRuntimeTimeoutFailure.code
    timeoutDiagnosticCollectionError = [string]$ftpRuntimeTimeoutFailure.details.diagnostics.diagnosticsError
  }
  featureRestart = [ordered]@{
    restartRequired = [bool]$featureRestart.restartRequired
    restartFeature = [string]$featureRestart.restartFeature
    enabledFeatures = @($featureRestart.enabledFeatures)
    remainingFeatures = @($featureRestart.remainingFeatures)
    enableCalls = @($script:featureEnableCalls)
  }
  serviceRollback = [ordered]@{
    stopAction = [string]$serviceRollbackStop.runningStateAction
    stopStartupType = [string]$serviceRollbackStop.startupType
    skipAction = [string]$serviceRollbackSkip.runningStateAction
    skipReason = [string]$serviceRollbackSkip.runningStateReason
    skipOtherSiteCount = @($serviceRollbackSkip.otherStartedSites).Count
    startAction = [string]$serviceRollbackStart.runningStateAction
    startStartupType = [string]$serviceRollbackStart.startupType
  }
  firewallRollback = [ordered]@{
    succeeded = [bool]$firewallRollbackResult.succeeded
    enabledValue = [string]$script:firewallRollbackEnabledValue
    enabledType = [string]$script:firewallRollbackEnabledType
  }
  aclRights = $aclRights
  aclRecovery = [ordered]@{
    sourceCanonical = [bool]$nonCanonicalAcl.AreAccessRulesCanonical
    rebuiltCanonical = [bool]$canonicalAcl.AreAccessRulesCanonical
    sourceRuleCount = @($nonCanonicalAcl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])).Count
    rebuiltRuleCount = @($canonicalAcl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])).Count
    snapshotRestored = [bool]$aclRestoreFixture.succeeded
    snapshotMatched = [string]$aclRestoredFixture.sddl -eq [string]$aclSnapshotFixture.sddl
    nonCanonicalSnapshot = -not [bool]$nonCanonicalFixtureSnapshot.canonical
    nonCanonicalRestored = [bool]$nonCanonicalFixtureRestore.succeeded
    nonCanonicalSnapshotMatched = [string]$nonCanonicalFixtureRestored.sddl -eq [string]$nonCanonicalFixtureSnapshot.sddl
  }
  setupRestart = [ordered]@{
    exitCode = $setupRestartExitCode
    openManagerCalls = $script:setupOpenManagerCalls
    ok = [bool]$setupRestartEnvelope.ok
    stage = [string]$setupRestartEnvelope.stage
    code = [string]$setupRestartEnvelope.code
    status = [string]$setupRestartEnvelope.data.status
    completedStepCount = @($setupRestartEnvelope.data.completedSteps).Count
    rollbackAttempted = [bool]$setupRestartEnvelope.rollbackAttempted
    rollbackStatus = [string]$setupRestartEnvelope.data.rollback.status
    preflightPresent = $null -ne $setupRestartEnvelope.data.preflight
    planPresent = $null -ne $setupRestartEnvelope.data.plan
    passwordLeaked = $setupRestartRaw.Contains('temporary-test-value')
  }
  exitCodes = [ordered]@{
    invalidInput = Get-MpwExitCode -Code 'INVALID_PARAMETER'
    admin = Get-MpwExitCode -Code 'ADMIN_REQUIRED'
    features = Get-MpwExitCode -Code 'IIS_FEATURE_ENABLE_FAILED'
    restartRequired = Get-MpwExitCode -Code 'WINDOWS_RESTART_REQUIRED'
    site = Get-MpwExitCode -Code 'IIS_SITE_ADOPTION_REQUIRED'
    account = Get-MpwExitCode -Code 'FTP_ACCOUNT_CONFLICT'
    acl = Get-MpwExitCode -Code 'FTP_ACL_FAILED'
    firewall = Get-MpwExitCode -Code 'FIREWALL_CONFIG_FAILED'
    service = Get-MpwExitCode -Code 'IIS_SERVICE_START_FAILED'
    ftpSiteStart = Get-MpwExitCode -Code 'IIS_FTP_SITE_START_FAILED'
    rollback = Get-MpwExitCode -Code 'IIS_ROLLBACK_FAILED'
  }
}
'MPW_TEST_RESULT:' + ($result | ConvertTo-Json -Depth 12 -Compress)
if ($parserFailures.Count -gt 0) { exit 1 }
exit 0
`.replace(/^\n/, "");
    fs.writeFileSync(harnessPath, `\uFEFF${harness}`, "utf8");

    const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const validation = spawnSync(powershell, [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", harnessPath,
      "-ScriptsDirectory", scriptsDirectory,
      "-OutputPath", outputPath
    ], { cwd: root, encoding: "utf8" });
    assert.equal(validation.status, 0, validation.stderr || validation.stdout);
    const resultLine = validation.stdout.split(/\r?\n/).find((line) => line.startsWith("MPW_TEST_RESULT:"));
    assert.ok(resultLine, validation.stdout);
    const result = JSON.parse(resultLine.slice("MPW_TEST_RESULT:".length));
    const fileEnvelope = JSON.parse(fs.readFileSync(outputPath, "utf8").replace(/^\uFEFF/, ""));
    assert.deepEqual(result.parserFailures, []);
    assert.deepEqual(result.enumNormalization, {
      sslControlZero: "SslAllow",
      sslDataZero: "SslAllow",
      accessTypeZero: "Allow",
      permissionsThree: "Read, Write",
      permissionsNamed: "Read, Write",
      firewallEnabledTrue: "True"
    });
    assert.equal(fileEnvelope.ok, false);
    assert.equal(fileEnvelope.stage, "configure_firewall");
    assert.equal(fileEnvelope.code, "FIREWALL_CONFIG_FAILED");
    assert.equal(fileEnvelope.siteName, "测试站点");
    assert.equal(fileEnvelope.rollbackAttempted, true);
    assert.equal(fileEnvelope.rollbackSucceeded, true);
    assert.equal(fileEnvelope.command, "Set-NetFirewallRule");
    assert.deepEqual(result.reparseSafety, {
      cloudPlaceholderUnsafe: false,
      junctionUnsafe: true,
      normalDirectoryUnsafe: false
    });
    assert.equal(result.ftpRuntime.stateAfterStart, "Started");
    assert.equal(result.ftpRuntime.stateAfterStop, "Stopped");
    assert.equal(result.ftpRuntime.numericStateAfterStart, "Started");
    assert.equal(result.ftpRuntime.numericStateAfterStop, "Stopped");
    assert.equal(result.ftpRuntime.startCalls, 1);
    assert.equal(result.ftpRuntime.stopCalls, 1);
    assert.equal(result.ftpRuntime.failureCode, "IIS_FTP_SITE_START_FAILED");
    assert.equal(result.ftpRuntime.failureCommand, "ftpServer.Start");
    assert.equal(result.ftpRuntime.failureHresult, "0x80070020");
    assert.equal(typeof result.ftpRuntime.failureServiceState, "string");
    assert.equal(result.ftpRuntime.diagnosticFailureCode, "IIS_FTP_SITE_START_FAILED");
    assert.equal(result.ftpRuntime.diagnosticFailureHresult, "0x80070020");
    assert.match(result.ftpRuntime.diagnosticCollectionError, /Synthetic StrictMode diagnostics failure/);
    assert.equal(result.ftpRuntime.partialSiteFailureCode, "IIS_FTP_SITE_START_FAILED");
    assert.equal(result.ftpRuntime.partialSiteFailureHresult, "0x80070020");
    assert.equal(result.ftpRuntime.timeoutFailureCode, "IIS_FTP_SITE_START_FAILED");
    assert.match(result.ftpRuntime.timeoutDiagnosticCollectionError, /Synthetic StrictMode diagnostics failure/);
    assert.deepEqual(result.featureRestart, {
      restartRequired: true,
      restartFeature: "IIS-FTPServer",
      enabledFeatures: ["IIS-FTPServer"],
      remainingFeatures: ["IIS-FTPSvc", "IIS-FTPExtensibility", "IIS-ManagementScriptingTools"],
      enableCalls: ["IIS-FTPServer"]
    });
    assert.deepEqual(result.serviceRollback, {
      stopAction: "stop",
      stopStartupType: "Manual",
      skipAction: "skip",
      skipReason: "OTHER_FTP_SITES_RUNNING",
      skipOtherSiteCount: 1,
      startAction: "start",
      startStartupType: "Disabled"
    });
    assert.deepEqual(result.firewallRollback, {
      succeeded: true,
      enabledValue: "True",
      enabledType: "System.String"
    });
    assert.deepEqual(result.aclRights, {
      read: false,
      readAndExecute: false,
      write: true,
      modify: true,
      fullControl: true
    });
    assert.deepEqual(result.aclRecovery, {
      sourceCanonical: false,
      rebuiltCanonical: true,
      sourceRuleCount: 2,
      rebuiltRuleCount: 2,
      snapshotRestored: true,
      snapshotMatched: true,
      nonCanonicalSnapshot: true,
      nonCanonicalRestored: true,
      nonCanonicalSnapshotMatched: true
    });
    assert.deepEqual(result.setupRestart, {
      exitCode: 4,
      openManagerCalls: 1,
      ok: false,
      stage: "windows_restart_required",
      code: "WINDOWS_RESTART_REQUIRED",
      status: "restart_required",
      completedStepCount: 2,
      rollbackAttempted: false,
      rollbackStatus: "not_required",
      preflightPresent: true,
      planPresent: true,
      passwordLeaked: false
    });
    assert.deepEqual(result.exitCodes, {
      invalidInput: 2,
      admin: 3,
      features: 4,
      restartRequired: 4,
      site: 5,
      account: 6,
      acl: 7,
      firewall: 8,
      service: 9,
      ftpSiteStart: 9,
      rollback: 10
    });

    const source = Object.fromEntries(
      fs.readdirSync(scriptsDirectory)
        .filter((name) => name.endsWith(".ps1"))
        .map((name) => [name, fs.readFileSync(path.join(scriptsDirectory, name), "utf8")])
    );
    // Negative migration guard: management scripts must remain IIS-only and must not
    // reintroduce the retired Node provider or its former fixed control port.
    const retiredProviderPattern = new RegExp(["ftp", "srv"].join("-"), "i");
    const retiredFixedPortPattern = new RegExp(`\\b${2100 + 21}\\b`);
    for (const [name, contents] of Object.entries(source)) {
      assert.doesNotMatch(contents, retiredProviderPattern, `${name} must stay IIS-only`);
      assert.doesNotMatch(contents, retiredFixedPortPattern, `${name} must use the configured control port`);
    }
    for (const name of ["iis-ftp-setup.ps1", "iis-ftp-adopt.ps1"]) {
      assert.match(source[name], /options\.Binding/);
      assert.match(source[name], /PassivePortStart/);
      assert.match(source[name], /PassivePortEnd/);
      assert.match(source[name], /configure_directory_acl/);
      assert.match(source[name], /configure_firewall/);
      assert.match(source[name], /verify_configuration/);
      assert.match(source[name], /Get-MpwExitCode/);
    }
    assert.match(source["iis-ftp-common.ps1"], /Media Photo Workbench Managed FTP Account/);
    assert.match(source["iis-ftp-common.ps1"], /RemoteAddress LocalSubnet/);
    assert.match(source["iis-ftp-common.ps1"], /FIREWALL_RULE_UPDATE_CONFIRMATION_REQUIRED/);
    assert.match(source["iis-ftp-common.ps1"], /FIREWALL_RULE_POLICY_BLOCKED/);
    assert.match(source["iis-ftp-common.ps1"], /AllowLegacyFirewallRuleUpdate/);
    assert.match(source["iis-ftp-common.ps1"], /policyStoreSourceType -ne 'Local'/i);
    assert.match(source["iis-ftp-common.ps1"], /Restore-MpwFirewallRuleSnapshot/);
    assert.match(source["iis-ftp-common.ps1"], /Restore-MpwFirewallRuleChange/);
    assert.match(source["iis-ftp-common.ps1"], /FIREWALL_ROLLBACK_VERIFY_FAILED/);
    assert.match(source["iis-ftp-common.ps1"], /ConvertTo-MpwFtpSslPolicyName/);
    assert.match(source["iis-ftp-common.ps1"], /ConvertTo-MpwFtpAuthorizationAccessTypeName/);
    assert.match(source["iis-ftp-common.ps1"], /ConvertTo-MpwFtpAuthorizationPermissionsName/);
    assert.match(source["iis-ftp-common.ps1"], /\$ftpServer\.Methods\[\$MethodName\]/);
    assert.match(source["iis-ftp-common.ps1"], /\['serverAutoStart'\] = \$true/);
    assert.doesNotMatch(source["iis-ftp-common.ps1"], /\$Site\.(?:Start|Stop)\(/,
      "FTP runtime must use ftpServer Start/Stop methods, not generic web site methods");
    assert.doesNotMatch(source["iis-ftp-common.ps1"], /\$Site\.ServerAutoStart/,
      "FTP automatic start belongs to the site-level ftpServer element");
    assert.match(source["iis-ftp-common.ps1"], /Set-NetFirewallRule -Name \$ruleName -NewDisplayName/);
    assert.doesNotMatch(source["iis-ftp-common.ps1"], /Set-NetFirewallRule[^\r\n]*-Name[^\r\n]*-DisplayName/,
      "Set-NetFirewallRule must use NewDisplayName when selecting a rule by Name");
    assert.match(source["iis-ftp-common.ps1"], /broadInheritedAccess/);
    assert.match(source["iis-ftp-common.ps1"], /IIS_SITE_ADOPTION_REQUIRED/);
    assert.match(source["iis-ftp-common.ps1"], /Get-MpwIisSiteIdentityModel -Site \$site/);
    assert.doesNotMatch(source["iis-ftp-setup.ps1"], /autoAdoptSingleSite/);
    assert.match(source["iis-ftp-common.ps1"], /Get-MpwAvailableControlPorts/);
    assert.match(source["iis-ftp-common.ps1"], /Get-MpwExcludedTcpPortRanges/);
    assert.match(source["iis-ftp-common.ps1"], /FTP_CONTROL_PORT_INVALID/);
    assert.match(source["iis-ftp-common.ps1"], /FTP_PORT_RANGE_CONFLICT/);
    const globalPassiveHelpers = source["iis-ftp-common.ps1"].match(/function Get-MpwGlobalPassivePorts[\s\S]*?(?=function Get-MpwFtpServiceStatus)/)?.[0] || "";
    assert.match(globalPassiveHelpers, /lowDataChannelPort/);
    assert.match(globalPassiveHelpers, /highDataChannelPort/);
    assert.doesNotMatch(globalPassiveHelpers, /externalIp4Address/, "global IIS FTP firewallSupport has no externalIp4Address attribute");
    const authorizationSources = [source["iis-ftp-common.ps1"], source["iis-ftp-credentials.ps1"]].join("\n");
    assert.match(source["iis-ftp-common.ps1"], /GetSection\('system\.ftpServer\/security\/authorization', \$SiteName\)/);
    assert.doesNotMatch(authorizationSources, /GetChildElement\('authorization'\)/, "FTP authorization is a location-scoped configuration section, not a site ftpServer child element");
    for (const name of ["iis-ftp-setup.ps1", "iis-ftp-adopt.ps1", "iis-ftp-control.ps1", "iis-ftp-credentials.ps1"]) {
      assert.doesNotMatch(source[name], /Get-Mpw(?:FtpSiteModel|SiteSnapshot) -Site/);
      assert.doesNotMatch(source[name], /Set-Mpw(?:FtpSiteConfiguration|SiteAuthorizationUser) -Site/);
      assert.doesNotMatch(source[name], /Restore-MpwSiteSnapshot -Site/);
    }
    assert.match(source["iis-ftp-setup.ps1"], /PORT_USED_BY_OTHER_PROCESS/);
    assert.match(source["iis-ftp-setup.ps1"], /IIS_SITE_PORT_CONFLICT/);
    assert.match(source["iis-ftp-setup.ps1"], /preflight_firewall[\s\S]*Assert-MpwFirewallRuleUpdatesAllowed/);
    assert.match(source["iis-ftp-setup.ps1"], /AllowLegacyRuleUpdate \$options\.AllowLegacyFirewallRuleUpdate/);
    assert.match(source["iis-ftp-setup.ps1"], /Restore-MpwFirewallRuleChange/);
    assert.match(source["iis-ftp-adopt.ps1"], /preflight_firewall[\s\S]*Assert-MpwFirewallRuleUpdatesAllowed/);
    assert.match(source["iis-ftp-adopt.ps1"], /Restore-MpwFirewallRuleChange/);
    assert.doesNotMatch(source["iis-ftp-setup.ps1"], /Ensure-MpwFirewallRule[^\n]+LocalPort '21'/);
    assert.match(source["iis-ftp-control.ps1"], /start_ftp_service/);
    for (const name of ["iis-ftp-setup.ps1", "iis-ftp-adopt.ps1", "iis-ftp-control.ps1"]) {
      assert.match(source[name], /start_ftp_site/);
      assert.match(source[name], /verify_ftp_listener/);
    }
    assert.match(source["iis-ftp-control.ps1"], /stop_ftp_site/);
    assert.match(source["iis-ftp-control.ps1"], /prepare_target_directory/);
    assert.match(source["iis-ftp-control.ps1"], /snapshot_current_state/);
    assert.match(source["iis-ftp-control.ps1"], /update_target_acl/);
    assert.match(source["iis-ftp-control.ps1"], /update_iis_physical_path/);
    assert.match(source["iis-ftp-control.ps1"], /restart_ftp_site/);
    assert.match(source["iis-ftp-control.ps1"], /preserve_stopped_site/);
    assert.match(source["iis-ftp-control.ps1"], /verify_switched_state/);
    assert.match(source["iis-ftp-control.ps1"], /rollback_physical_path/);
    assert.match(source["iis-ftp-control.ps1"], /rollback_site_state/);
    assert.match(source["iis-ftp-control.ps1"], /FTP_PHYSICAL_PATH_UPDATE_FAILED/);
    assert.match(source["iis-ftp-control.ps1"], /FTP_SITE_RESTART_FAILED/);
    assert.match(source["iis-ftp-control.ps1"], /FTP_SWITCH_VERIFY_FAILED/);
    assert.match(source["iis-ftp-control.ps1"], /Wait-MpwPortListener[^\r\n]*15000/,
      "event switching must allow the IIS FTP listener time to stabilize before verification");
    assert.match(source["iis-ftp-status.ps1"], /inspect_iis_sites/);
    assert.match(source["iis-ftp-common.ps1"], /function Get-MpwFtpServiceRollbackDecision/);
    assert.match(source["iis-ftp-common.ps1"], /function Restore-MpwFtpServiceSnapshot/);
    assert.match(source["iis-ftp-common.ps1"], /OTHER_FTP_SITES_RUNNING/);
    assert.match(source["iis-ftp-setup.ps1"], /Restore-MpwFtpServiceSnapshot -Snapshot \$serviceSnapshot/);
    assert.match(source["iis-ftp-setup.ps1"], /completedSteps = @\(\$steps\)/);
    assert.match(source["iis-ftp-setup.ps1"], /rollback = \$rollback/);
    const restartGateStart = source["iis-ftp-setup.ps1"].indexOf("$currentStage = 'enable_iis_features'");
    const restartGateEnd = source["iis-ftp-setup.ps1"].indexOf("$currentStage = 'open_iis_configuration'", restartGateStart);
    assert.ok(restartGateStart >= 0 && restartGateEnd > restartGateStart);
    const restartGate = source["iis-ftp-setup.ps1"].slice(restartGateStart, restartGateEnd);
    assert.match(restartGate, /WINDOWS_RESTART_REQUIRED/);
    assert.match(restartGate, /Write-MpwScriptResult[\s\S]*-Stage 'windows_restart_required'/);
    assert.match(restartGate, /return \(Get-MpwExitCode -Code 'WINDOWS_RESTART_REQUIRED'\)/);
    assert.match(source["iis-ftp-common.ps1"], /function Test-MpwWriteCapableFileSystemRights/);
    assert.match(source["iis-ftp-common.ps1"], /function Remove-MpwBroadDirectoryWriteAccess/);
    assert.match(source["iis-ftp-common.ps1"], /S-1-1-0[\s\S]*S-1-5-11[\s\S]*S-1-5-32-545/);
    assert.match(source["iis-ftp-common.ps1"], /function ConvertTo-MpwCanonicalDirectorySecurity/);
    assert.match(source["iis-ftp-common.ps1"], /ConvertTo-MpwCanonicalDirectorySecurity -Acl \$acl -ProtectAccessRules \$true -IncludeInheritedRules \$true/);
    assert.doesNotMatch(source["iis-ftp-common.ps1"], /SetAccessRuleProtection\(\$true, \$true\)/, "in-place inherited ACE conversion can create a non-canonical DACL");
    assert.match(source["iis-ftp-common.ps1"], /RemoveAccessRuleSpecific\(\$rule\)/);
    assert.doesNotMatch(source["iis-ftp-common.ps1"], /RemoveAccessRuleAll/);
    assert.match(source["iis-ftp-setup.ps1"], /if \(\$allowAclTightening\)[\s\S]*Remove-MpwBroadDirectoryWriteAccess -PhysicalPath \$physicalPath/);
    assert.match(source["iis-ftp-common.ps1"], /function Get-MpwDirectoryAclSnapshot/);
    assert.match(source["iis-ftp-common.ps1"], /GetSecurityDescriptorSddlForm/);
    assert.match(source["iis-ftp-common.ps1"], /function Restore-MpwDirectoryAclSnapshot/);
    assert.match(source["iis-ftp-common.ps1"], /FTP_ACL_ROLLBACK_VERIFY_FAILED/);
    assert.match(source["iis-ftp-setup.ps1"], /\$aclSnapshot = Get-MpwDirectoryAclSnapshot -PhysicalPath \$physicalPath/);
    assert.match(source["iis-ftp-setup.ps1"], /Restore-MpwDirectoryAclSnapshot -PhysicalPath \$options\.PhysicalPath -Snapshot \$aclSnapshot/);
    assert.match(source["iis-ftp-control.ps1"], /Restore-MpwDirectoryAclSnapshot -PhysicalPath \$newPath -Snapshot \$newAclSnapshot/);
    assert.match(source["iis-ftp-control.ps1"], /FTP_ACL_ROLLBACK_VERIFY_FAILED/);
    assert.match(source["iis-ftp-control.ps1"], /Restore-MpwFtpServiceSnapshot -Snapshot \$serviceSnapshot/);
    assert.match(source["iis-ftp-control.ps1"], /FTP_SITE_RUNTIME_ROLLBACK_FAILED/);
    assert.match(source["iis-ftp-setup.ps1"], /FTP_ACCOUNT_ROLLBACK_DEFERRED/);
    assert.match(source["iis-ftp-common.ps1"], /aclStage = 'canonicalize_acl'/);
    assert.match(source["iis-ftp-common.ps1"], /sourceExceptionType[\s\S]*hresult[\s\S]*acl = Get-MpwDirectoryAclDiagnostics/);
    assert.match(source["iis-ftp-setup.ps1"], /failedCodes = \$failedVerificationCodes/);
    assert.match(source["iis-ftp-setup.ps1"], /SITE_NOT_STARTED/);
    assert.match(source["iis-ftp-setup.ps1"], /CONTROL_PORT_NOT_LISTENING/);
    assert.match(source["iis-ftp-setup.ps1"], /SITE_BINDING_MISMATCH/);
    assert.match(source["iis-ftp-setup.ps1"], /PHYSICAL_PATH_MISMATCH/);
    assert.match(source["iis-ftp-setup.ps1"], /FTP_ACCOUNT_PERMISSION_FAILED/);
    assert.match(source["iis-ftp-setup.ps1"], /IIS_AUTH_CONFIGURATION_MISMATCH/);
    assert.match(source["iis-ftp-setup.ps1"], /FIREWALL_RULE_MISMATCH/);
    assert.match(source["iis-ftp-setup.ps1"], /PASSIVE_PORT_MISMATCH/);
    assert.match(source["iis-ftp-setup.ps1"], /MANAGED_SITE_ID_MISMATCH/);

    console.log(JSON.stringify({
      suite: "cameraFtpPowerShell",
      powershellVersion: "5.1",
      filesParsed: Object.keys(source).length,
      passed: [
        "windows_powershell_parser",
        "structured_result_schema",
        "iis_numeric_enum_normalization",
        "distinct_exit_codes",
        "onedrive_placeholder_path_validation",
        "setup_and_adoption_stages",
        "dynamic_binding_passive_firewall_acl_contract",
        "global_passive_port_schema_contract",
        "site_authorization_section_contract",
        "control_port_conflict_classification",
        "available_port_suggestions",
        "legacy_firewall_rule_confirmation_and_policy_guard",
        "firewall_rule_update_and_rollback_contract",
        "firewall_rollback_enum_and_post_verify",
        "ftp_specific_runtime_start_stop_contract",
        "atomic_event_path_switch_stage_contract",
        "event_switch_rollback_verification_contract",
        "ftp_runtime_hresult_unwrap",
        "ftp_runtime_diagnostics_preserve_original_error",
        "windows_restart_required_terminal_gate",
        "ftpsvc_snapshot_rollback_safety",
        "structured_completed_steps_and_rollback",
        "explicit_acl_tightening_preserves_read_only_rules",
        "noncanonical_acl_rebuild_contract",
        "sddl_acl_snapshot_and_verified_rollback",
        "verification_failure_diff_diagnostics",
        "iis_only_guard"
      ]
    }, null, 2));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main();
