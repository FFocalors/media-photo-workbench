param(
    [string]$InputPath,
    [string]$OutputPath
)

$commonPath = Join-Path $PSScriptRoot 'iis-ftp-common.ps1'
. $commonPath

function Assert-MpwSetupSiteOwnership {
    param(
        [Parameter(Mandatory = $true)]$Manager,
        [Parameter(Mandatory = $true)]$Options,
        [Parameter(Mandatory = $true)][string]$Action,
        [AllowNull()][string]$TargetSiteName = $null,
        [bool]$ConfirmAdoption = $false
    )

    $existingSite = $null
    if ($Action -eq 'adopt') {
        if (-not $ConfirmAdoption -or [string]::IsNullOrWhiteSpace($TargetSiteName)) {
            Throw-MpwFailure -Code 'IIS_SITE_ADOPTION_REQUIRED' -Message 'Explicit site identity confirmation is required before adoption.'
        }
        $targetName = Assert-MpwSiteName -SiteName $TargetSiteName
        $existingSite = $Manager.Sites[$targetName]
        if ($null -eq $existingSite) {
            Throw-MpwFailure -Code 'IIS_SITE_NOT_FOUND' -Message 'The explicitly selected IIS FTP site no longer exists.'
        }
        if (@($existingSite.Bindings | Where-Object { $_.Protocol -eq 'ftp' }).Count -eq 0) {
            Throw-MpwFailure -Code 'IIS_SITE_CONFLICT' -Message 'The selected IIS site is not an FTP site and cannot be adopted by this workflow.'
        }
        # Freeze the exact identity selected by the user. Subsequent lookup and
        # rollback use this Site ID even if the persisted display name was stale.
        $Options.SiteName = [string]$existingSite.Name
        $Options.ManagedSiteId = [long]$existingSite.Id
    }
    elseif ($Options.ManagedSiteId -gt 0) {
        $existingSite = Get-MpwIisSiteById -Manager $Manager -SiteId $Options.ManagedSiteId
        if ($null -ne $existingSite) {
            if (-not (Test-MpwSiteManagedByAccount -Site $existingSite -SiteName $Options.SiteName -Username $Options.Username -ManagedSiteId $Options.ManagedSiteId)) {
                $identity = Get-MpwIisSiteIdentityModel -Site $existingSite
                Throw-MpwFailure -Code 'IIS_SITE_ADOPTION_REQUIRED' -Message 'The persisted IIS Site ID no longer satisfies the workbench ownership marker.' -Details ([ordered]@{
                    port = $Options.ControlPort
                    siteName = [string]$identity.name
                    siteId = [long]$identity.id
                    source = 'managedSiteId'
                    adoptable = $true
                    canChangePort = $true
                    recommendation = 'Confirm the exact Site ID before adopting it again, or choose another port.'
                })
            }
            $Options.SiteName = [string]$existingSite.Name
        }
    }

    if ($null -eq $existingSite) { $existingSite = $Manager.Sites[$Options.SiteName] }
    if ($Action -ne 'adopt' -and $null -ne $existingSite -and -not (Test-MpwSiteManagedByAccount -Site $existingSite -SiteName $Options.SiteName -Username $Options.Username -ManagedSiteId $Options.ManagedSiteId)) {
        $identity = Get-MpwIisSiteIdentityModel -Site $existingSite
        Throw-MpwFailure -Code 'IIS_SITE_ADOPTION_REQUIRED' -Message 'An IIS site with the configured name requires explicit adoption before it can be modified.' -Details ([ordered]@{
            port = $Options.ControlPort
            siteName = [string]$identity.name
            source = 'iisSite'
            adoptable = $true
            canChangePort = $true
            availablePorts = @(Get-MpwAvailableControlPorts -PreferredPort 21 -PassiveStart $Options.PassivePortStart -PassiveEnd $Options.PassivePortEnd -Count 5)
            recommendation = 'Explicitly adopt the site only after confirming its ownership, or choose another site name.'
            candidates = @([ordered]@{ siteName = [string]$identity.name; siteId = [long]$identity.id; physicalPath = [string]$identity.physicalPath; bindings = @($identity.bindings); state = [string]$identity.state; adoptable = $true })
        })
    }

    $excludeName = if ($null -ne $existingSite) { [string]$existingSite.Name } else { $Options.SiteName }
    $otherSites = @(Find-MpwPortSites -Manager $Manager -Port $Options.ControlPort -ExcludeSiteName $excludeName)
    if ($otherSites.Count -gt 0) {
        $candidates = @($otherSites | ForEach-Object {
            $verifiedTestSite = [string]$_.name -eq 'MPW-IIS-FTP-Test'
            [ordered]@{ siteName = [string]$_.name; siteId = [long]$_.id; physicalPath = [string]$_.physicalPath; bindings = @($_.bindings); state = [string]$_.state; adoptable = $true; verifiedWithNikon = $verifiedTestSite }
        })
        $singleAdoptable = $candidates.Count -eq 1 -and [bool]$candidates[0].adoptable
        Throw-MpwFailure -Code 'IIS_SITE_PORT_CONFLICT' -Message 'Another IIS FTP site uses the configured control port. It was not modified.' -Details ([ordered]@{
            port = $Options.ControlPort
            siteName = if ($candidates.Count -eq 1) { [string]$candidates[0].siteName } else { '' }
            source = 'iisSite'
            adoptable = $singleAdoptable
            canChangePort = $true
            availablePorts = @(Get-MpwAvailableControlPorts -PreferredPort 21 -PassiveStart $Options.PassivePortStart -PassiveEnd $Options.PassivePortEnd -Count 5)
            recommendation = if ($singleAdoptable) { 'Choose another port or explicitly adopt the eligible IIS FTP site.' } else { 'Choose another available control port. Unrelated IIS sites will not be modified.' }
            candidates = $candidates
        })
    }
    return $existingSite
}

function New-MpwProvisioningPlanItem {
    param(
        [Parameter(Mandatory = $true)][string]$Id,
        [Parameter(Mandatory = $true)][string]$Resource,
        [Parameter(Mandatory = $true)][ValidateSet('already_ok', 'create', 'update', 'repair', 'user_confirmation_required', 'blocked')][string]$Status,
        [Parameter(Mandatory = $true)][string]$Reason,
        [bool]$ManagedResource = $true,
        [string]$ConfirmationKey = ''
    )
    return [ordered]@{
        id = $Id
        resource = $Resource
        status = $Status
        reason = $Reason
        managedResource = $ManagedResource
        confirmationKey = $ConfirmationKey
    }
}

function Invoke-MpwIisFtpSetup {
    param(
        [Parameter(Mandatory = $true)][string]$InputPath,
        [Parameter(Mandatory = $true)][string]$OutputPath
    )

    $action = 'setup'
    $inputObject = $null
    $password = $null
    $options = $null
    $physicalPath = $null
    $manager = $null
    $preflightManager = $null
    $site = $null
    $siteSnapshot = $null
    $passiveSnapshot = $null
    $featureSnapshot = $null
    $serviceSnapshot = $null
    $accountResult = $null
    $controlFirewallResult = $null
    $passiveFirewallResult = $null
    $aclSnapshot = $null
    $aclTighteningResult = $null
    $siteCreated = $false
    $siteWasStarted = $false
    $commitAttempted = $false
    $serviceMutationAttempted = $false
    $currentStage = 'read_input'
    $steps = [Collections.Generic.List[object]]::new()
    $warnings = [Collections.Generic.List[object]]::new()
    $preflight = $null
    $provisioningPlan = $null
    $targetSiteName = ''
    $confirmAdoption = $false
    $allowAclTightening = $false
    $passwordSubmitted = $false

    try {
        $currentStage = 'read_input'
        $inputObject = Read-MpwJsonInput -Path $InputPath -DeleteAfterRead
        $currentStage = 'validate_input'
        Assert-MpwAllowedInputProperties -InputObject $inputObject -AllowedProperties @((Get-MpwCommonInputProperties) + @('password', 'targetSiteName', 'confirmAdoption', 'allowAclTightening'))
        $action = Assert-MpwAction -InputObject $inputObject -AllowedActions @('setup', 'repair', 'start', 'restart', 'adopt')
        $currentStage = 'check_permissions'
        Assert-MpwAdministrator
        if ($env:OS -ne 'Windows_NT' -or [Environment]::OSVersion.Version.Build -lt 22000) {
            Throw-MpwFailure -Code 'UNSUPPORTED_PLATFORM' -Message 'IIS FTP management is supported only on Windows 11.'
        }

        $currentStage = 'validate_configuration'
        $options = Get-MpwNormalizedOptions -InputObject $inputObject -RequirePath
        $physicalPath = Assert-MpwPhysicalPath -PhysicalPath $options.PhysicalPath -AllowMissing
        $options.PhysicalPath = $physicalPath
        if (Test-MpwInputProperty -InputObject $inputObject -Name 'password') {
            $password = Assert-MpwPassword -Password (Get-MpwInputValue -InputObject $inputObject -Name 'password')
            $passwordSubmitted = $true
        }
        $targetSiteName = [string](Get-MpwInputValue -InputObject $inputObject -Name 'targetSiteName' -DefaultValue '')
        foreach ($flagName in @('confirmAdoption', 'allowAclTightening')) {
            if (Test-MpwInputProperty -InputObject $inputObject -Name $flagName) {
                $flagValue = Get-MpwInputValue -InputObject $inputObject -Name $flagName
                if ($flagValue -isnot [bool]) { Throw-MpwFailure -Code 'INVALID_PARAMETER' -Message "$flagName must be a boolean." }
                if ($flagName -eq 'confirmAdoption') { $confirmAdoption = [bool]$flagValue }
                if ($flagName -eq 'allowAclTightening') { $allowAclTightening = [bool]$flagValue }
            }
        }

        $currentStage = 'preflight_account'
        $accountBefore = Get-MpwLocalAccountStatus -Username $options.Username
        if ($accountBefore.exists -eq $true -and $accountBefore.conflict -eq $true) {
            Throw-MpwFailure -Code 'FTP_ACCOUNT_CONFLICT' -Message 'The configured username is already owned by a non-managed Windows account.'
        }
        if ($accountBefore.exists -eq $false -and $null -eq $password) {
            Throw-MpwFailure -Code 'FTP_PASSWORD_REQUIRED' -Message 'A password is required to create the managed FTP account.'
        }

        $currentStage = 'preflight_port'
        $portBefore = Get-MpwPortStatus -Port $options.ControlPort -PassiveStart $options.PassivePortStart -PassiveEnd $options.PassivePortEnd
        if ($portBefore.reserved) {
            Throw-MpwFailure -Code 'FTP_CONTROL_PORT_RESERVED' -Message 'The configured FTP control port is reserved by Windows.' -Details ([ordered]@{ port = $options.ControlPort; source = 'windowsReservedPort'; reservedRange = [string]$portBefore.reservedRange; canChangePort = $true; availablePorts = @($portBefore.availablePorts); recommendation = 'Choose one of the available control ports.' })
        }
        if ($portBefore.usedByOtherProcess) {
            Throw-MpwFailure -Code 'PORT_USED_BY_OTHER_PROCESS' -Message 'The configured FTP control port is owned by another process.' -Details ([ordered]@{ port = $options.ControlPort; source = 'process'; pid = $portBefore.pid; processName = [string]$portBefore.processName; canChangePort = $true; availablePorts = @($portBefore.availablePorts); recommendation = 'Do not stop the other process automatically. Choose another available control port.' })
        }
        $currentStage = 'preflight_firewall'
        Assert-MpwFirewallRuleUpdatesAllowed -Options $options
        [void]$steps.Add([ordered]@{ name = 'preflight'; status = 'success'; message = 'Platform, account, path, and port preflight passed.' })

        $currentStage = 'inspect_iis_sites'
        $preflightSite = $null
        $preflightSiteIdentity = $null
        $preflightSiteState = 'Unknown'
        try {
            $preflightManager = Open-MpwServerManager
            $preflightSite = Assert-MpwSetupSiteOwnership -Manager $preflightManager -Options $options -Action $action -TargetSiteName $targetSiteName -ConfirmAdoption $confirmAdoption
            if ($null -ne $preflightSite) {
                $preflightSiteIdentity = Get-MpwIisSiteIdentityModel -Site $preflightSite
                $preflightSiteState = [string]$preflightSiteIdentity.state
            }
        }
        catch {
            $preflightError = ConvertTo-MpwSafeException -ErrorRecord $_
            if ($preflightError.code -ne 'IIS_FTP_NOT_INSTALLED') { throw }
        }
        finally {
            if ($null -ne $preflightManager) {
                $preflightManager.Dispose()
                $preflightManager = $null
            }
        }

        $featureSnapshot = @(Get-MpwWindowsFeaturesStatus)
        $serviceSnapshot = Get-MpwFtpServiceStatus
        $aclBefore = Get-MpwDirectoryAclStatus -PhysicalPath $physicalPath -Username $options.Username
        $featureMissing = @($featureSnapshot | Where-Object { $_.state -eq 'Disabled' }).Count -gt 0
        $featureUnknown = @($featureSnapshot | Where-Object { $_.state -eq 'unknown' }).Count -gt 0
        $planItems = [Collections.Generic.List[object]]::new()
        [void]$planItems.Add((New-MpwProvisioningPlanItem -Id 'windows-features' -Resource 'windows_feature' -Status $(if ($featureMissing) { 'create' } elseif ($featureUnknown) { 'repair' } else { 'already_ok' }) -Reason 'Required IIS FTP Windows features are reconciled before site changes.'))
        [void]$planItems.Add((New-MpwProvisioningPlanItem -Id 'directory' -Resource 'directory' -Status $(if ([IO.Directory]::Exists($physicalPath)) { 'already_ok' } else { 'create' }) -Reason 'The event 原图/相机FTP directory is the final upload and original location.'))
        [void]$planItems.Add((New-MpwProvisioningPlanItem -Id 'account' -Resource 'account' -Status $(if ($accountBefore.exists -eq $false) { 'create' } elseif ($accountBefore.enabled -ne $true) { 'repair' } else { 'already_ok' }) -Reason 'Only the account carrying the workbench management marker is changed.'))
        [void]$planItems.Add((New-MpwProvisioningPlanItem -Id 'iis-site' -Resource 'iis_site' -Status $(if ($null -eq $preflightSite) { 'create' } elseif ($action -eq 'adopt') { 'update' } else { 'repair' }) -Reason 'The managed site is resolved by Site ID before its display name.'))
        [void]$planItems.Add((New-MpwProvisioningPlanItem -Id 'binding' -Resource 'binding' -Status 'repair' -Reason "The target managed site uses $($options.Binding); unrelated site bindings are preserved."))
        [void]$planItems.Add((New-MpwProvisioningPlanItem -Id 'authentication' -Resource 'authentication' -Status 'repair' -Reason 'Basic is enabled, Anonymous is disabled and SSL is not required.'))
        [void]$planItems.Add((New-MpwProvisioningPlanItem -Id 'authorization' -Resource 'authorization' -Status 'repair' -Reason 'The managed FTP username receives Read and Write authorization.'))
        $aclPlanStatus = if ($aclBefore.broadInheritedAccess -eq $true -and -not $allowAclTightening) { 'user_confirmation_required' } elseif ($aclBefore.broadInheritedAccess -eq $true -and $allowAclTightening) { 'repair' } elseif ($aclBefore.readWriteAllowed -eq $true) { 'already_ok' } else { 'repair' }
        [void]$planItems.Add((New-MpwProvisioningPlanItem -Id 'acl' -Resource 'acl' -Status $aclPlanStatus -Reason 'Required access is added without deleting unrelated valid ACL entries.' -ConfirmationKey $(if ($aclPlanStatus -eq 'user_confirmation_required') { 'tighten-broad-acl' } else { '' })))
        [void]$planItems.Add((New-MpwProvisioningPlanItem -Id 'pasv' -Resource 'pasv' -Status 'update' -Reason 'PASV is an IIS server-level setting and is covered by the explicit provisioning confirmation.' -ConfirmationKey 'update-global-pasv'))
        [void]$planItems.Add((New-MpwProvisioningPlanItem -Id 'firewall' -Resource 'firewall' -Status 'repair' -Reason 'Only fixed workbench rule identities or explicitly confirmed legacy aliases are changed.'))
        [void]$planItems.Add((New-MpwProvisioningPlanItem -Id 'ftp-service' -Resource 'ftp_service' -Status $(if ($serviceSnapshot.running -eq $true -and $serviceSnapshot.startType -eq 'Auto') { 'already_ok' } else { 'repair' }) -Reason 'FTPSVC is started and awaited after IIS configuration is committed.'))
        [void]$planItems.Add((New-MpwProvisioningPlanItem -Id 'ftp-site-runtime' -Resource 'ftp_site_runtime' -Status $(if ($null -ne $preflightSiteIdentity -and $preflightSiteState -eq 'Started' -and $action -ne 'restart') { 'already_ok' } else { 'repair' }) -Reason 'The exact target FTP site is started and awaited.'))
        [void]$planItems.Add((New-MpwProvisioningPlanItem -Id 'verify' -Resource 'verification' -Status 'repair' -Reason 'Listener ownership, path, binding, authentication, authorization, ACL, PASV and firewall are re-read before commit.'))
        $preflight = [ordered]@{
            inspectionLevel = 'full'
            platform = [ordered]@{ supported = $true; version = [Environment]::OSVersion.Version.ToString() }
            windowsFeatures = $featureSnapshot
            service = $serviceSnapshot
            account = $accountBefore
            port = $portBefore
            directory = [ordered]@{ path = $physicalPath; exists = [IO.Directory]::Exists($physicalPath); acl = $aclBefore }
            site = $preflightSiteIdentity
            passwordProvided = $null -ne $password
        }
        $provisioningPlan = [ordered]@{
            schemaVersion = 1
            intent = $action
            targetState = 'running'
            items = @($planItems)
            canApply = @($planItems | Where-Object { $_.status -eq 'blocked' }).Count -eq 0
        }

        $currentStage = 'enable_iis_features'
        $featureResult = Enable-MpwRequiredWindowsFeatures
        if ($featureResult.restartRequired) {
            [void]$steps.Add([ordered]@{ name = 'windowsFeatures'; status = 'restart_required'; message = 'Windows enabled an IIS FTP feature and requires a restart before configuration can continue.' })
            $restartError = [ordered]@{
                code = 'WINDOWS_RESTART_REQUIRED'
                message = 'Windows must restart before IIS FTP configuration can continue.'
                technicalMessage = 'Enable-WindowsOptionalFeature returned RestartNeeded=true. No IIS site, account, ACL, firewall, or FTPSVC changes were attempted after that result.'
                exceptionType = ''
                command = 'Enable-WindowsOptionalFeature'
                details = [ordered]@{
                    restartRequired = $true
                    restartFeature = [string]$featureResult.restartFeature
                    enabledFeatures = @($featureResult.enabledFeatures)
                    remainingFeatures = @($featureResult.remainingFeatures)
                    recommendation = 'Restart Windows, reopen the workbench, and run the same setup action again.'
                }
            }
            $restartRollback = [ordered]@{
                attempted = $false
                status = 'not_required'
                succeeded = $null
                items = @()
                warnings = @()
                reason = 'Windows feature enablement is retained so setup can resume after restart.'
            }
            $restartData = [ordered]@{
                action = $action
                status = 'restart_required'
                message = 'Windows restart required; IIS FTP configuration has paused safely.'
                restartRequired = $true
                resumeAction = 'retry_after_windows_restart'
                steps = @($steps)
                completedSteps = @($steps)
                warnings = @()
                requiresAdmin = $false
                preflight = $preflight
                plan = $provisioningPlan
                rollback = $restartRollback
            }
            $password = $null
            Write-MpwScriptResult -OutputPath $OutputPath -Action $action -Ok $false -Stage 'windows_restart_required' -SiteName $options.SiteName -Data $restartData -ErrorObject $restartError -RollbackAttempted $false -RollbackSucceeded $null
            return (Get-MpwExitCode -Code 'WINDOWS_RESTART_REQUIRED')
        }
        [void]$steps.Add([ordered]@{ name = 'windowsFeatures'; status = 'success'; message = 'Required IIS FTP feature state was reconciled.' })

        $currentStage = 'open_iis_configuration'
        $manager = Open-MpwServerManager
        $site = Assert-MpwSetupSiteOwnership -Manager $manager -Options $options -Action $action -TargetSiteName $targetSiteName -ConfirmAdoption $confirmAdoption

        $currentStage = 'prepare_receive_directory'
        if ([IO.Directory]::Exists($physicalPath)) {
            $aclSnapshot = Get-MpwDirectoryAclSnapshot -PhysicalPath $physicalPath
        }
        $physicalPath = Assert-MpwPhysicalPath -PhysicalPath $physicalPath -Create
        $options.PhysicalPath = $physicalPath
        if ($null -eq $aclSnapshot -and [IO.Directory]::Exists($physicalPath)) {
            # A newly created receive directory still needs an ACL baseline so
            # grant/tightening changes can be restored if a later stage fails.
            $aclSnapshot = Get-MpwDirectoryAclSnapshot -PhysicalPath $physicalPath
        }

        $currentStage = 'configure_local_account'
        $accountResult = Ensure-MpwManagedLocalAccount -Username $options.Username -Password $password
        $password = $null
        [void]$steps.Add([ordered]@{ name = 'account'; status = 'success'; message = 'The managed local FTP account is ready.' })

        $currentStage = 'configure_directory_acl'
        $aclGrantResult = Grant-MpwDirectoryAccess -PhysicalPath $physicalPath -Username $options.Username
        [void]$steps.Add([ordered]@{
            name = 'acl'
            status = 'success'
            message = 'The FTP receive directory grants managed read/write access.'
            canonicalized = [bool]$aclGrantResult.canonicalized
            canonical = [bool]$aclGrantResult.canonical
        })
        if ($allowAclTightening) {
            $currentStage = 'tighten_directory_acl'
            $aclTighteningResult = Remove-MpwBroadDirectoryWriteAccess -PhysicalPath $physicalPath
            [void]$steps.Add([ordered]@{
                name = 'aclTightening'
                status = 'success'
                message = if ($aclTighteningResult.removedRuleCount -gt 0) { 'Confirmed broad write-capable ACL rules were removed while unrelated and read-only rules were preserved.' } else { 'No broad write-capable ACL rules required removal.' }
                removedRuleCount = [int]$aclTighteningResult.removedRuleCount
            })
        }

        $currentStage = 'configure_iis_site'
        if ($null -eq $site) {
            try {
                $site = $manager.Sites.Add($options.SiteName, 'ftp', $options.Binding, $physicalPath)
                $siteCreated = $true
            }
            catch {
                Throw-MpwFailure -Code 'IIS_CONFIG_FAILED' -Message 'The IIS FTP site could not be created.'
            }
        }
        else {
            $siteSnapshot = Get-MpwSiteSnapshot -Manager $manager -Site $site
            $siteWasStarted = [string]$siteSnapshot.state -eq 'Started'
            if ($siteWasStarted) { Stop-MpwSite -Site $site }
        }
        $currentStage = 'configure_iis_site'
        $passiveSnapshot = Get-MpwGlobalPassivePorts -Manager $manager
        Set-MpwFtpSiteConfiguration -Manager $manager -Site $site -PhysicalPath $physicalPath -Username $options.Username -Binding $options.Binding
        $currentStage = 'configure_passive_ports'
        Set-MpwGlobalPassivePorts -Manager $manager -Start $options.PassivePortStart -End $options.PassivePortEnd
        $currentStage = 'commit_iis_configuration'
        $commitAttempted = $true
        $manager.CommitChanges()
        $committedSite = $manager.Sites[$options.SiteName]
        if ($null -eq $committedSite -or [long]$committedSite.Id -le 0) {
            Throw-MpwFailure -Code 'IIS_CONFIG_FAILED' -Message 'The IIS FTP site identity could not be confirmed after configuration.'
        }
        $site = $committedSite
        $options.ManagedSiteId = [long]$site.Id
        [void]$steps.Add([ordered]@{ name = 'site'; status = 'success'; message = 'The IIS FTP site, wildcard binding, authentication, authorization, SSL policy, and passive ports are configured.' })

        $currentStage = 'configure_firewall'
        $controlFirewallResult = Ensure-MpwFirewallRule -Kind control -DisplayName $options.FirewallControlRuleName -LocalPort ([string]$options.ControlPort) -AllowLegacyRuleUpdate $options.AllowLegacyFirewallRuleUpdate
        $passiveFirewallResult = Ensure-MpwFirewallRule -Kind passive -DisplayName $options.FirewallPassiveRuleName -LocalPort "$($options.PassivePortStart)-$($options.PassivePortEnd)" -AllowLegacyRuleUpdate $options.AllowLegacyFirewallRuleUpdate
        [void]$steps.Add([ordered]@{ name = 'firewall'; status = 'success'; message = 'Windows Firewall allows FTP control and passive traffic from LocalSubnet.' })

        $currentStage = 'start_ftp_service'
        $serviceMutationAttempted = $true
        Start-MpwFtpService
        $currentStage = 'start_ftp_site'
        Start-MpwSite -Site $site
        $currentStage = 'verify_ftp_listener'
        $listener = Wait-MpwPortListener -Port $options.ControlPort -PassiveStart $options.PassivePortStart -PassiveEnd $options.PassivePortEnd -TimeoutMilliseconds 15000
        if (-not $listener.listening -or $listener.usedByOtherProcess) {
            Throw-MpwFailure -Code 'IIS_FTP_LISTENER_START_FAILED' -Message 'The IIS FTP site started but did not produce the expected Microsoft FTP Service listener.' -Command 'Get-NetTCPConnection' -Details ([ordered]@{
                port = $options.ControlPort
                siteName = $options.SiteName
                siteState = Get-MpwFtpSiteRuntimeState -Site $site
                listening = [bool]$listener.listening
                pid = $listener.pid
                processName = [string]$listener.processName
                technicalMessage = 'The configured control port did not become an FTPSVC listener within 15 seconds.'
            })
        }
        [void]$steps.Add([ordered]@{ name = 'start'; status = 'success'; message = 'Microsoft FTP Service and the IIS FTP site are running.' })

        $currentStage = 'verify_configuration'
        $siteAfter = Get-MpwFtpSiteModel -Manager $manager -Site $site
        $aclAfter = Get-MpwDirectoryAclStatus -PhysicalPath $physicalPath -Username $options.Username
        $authorizationOk = @($siteAfter.authorization | Where-Object { $_.accessType -eq 'Allow' -and $_.users -eq $options.Username -and $_.permissions -match 'Read' -and $_.permissions -match 'Write' }).Count -gt 0
        $bindingOk = @($siteAfter.bindings | Where-Object { $_.protocol -eq 'ftp' -and $_.bindingInformation -eq $options.Binding }).Count -eq 1
        $expectedPhysicalPath = $physicalPath.TrimEnd('\')
        $actualPhysicalPath = [IO.Path]::GetFullPath([string]$siteAfter.physicalPath).TrimEnd('\')
        $aclDiagnosticsAfter = Get-MpwDirectoryAclDiagnostics -PhysicalPath $physicalPath
        $verificationChecks = @(
            (New-MpwVerificationCheck -Id 'managedSiteId' -Code 'MANAGED_SITE_ID_MISMATCH' -Passed ([long]$siteAfter.id -eq [long]$options.ManagedSiteId) -Expected ([long]$options.ManagedSiteId) -Actual ([long]$siteAfter.id)),
            (New-MpwVerificationCheck -Id 'binding' -Code 'SITE_BINDING_MISMATCH' -Passed ([bool]$bindingOk) -Expected ([string]$options.Binding) -Actual @($siteAfter.bindings)),
            (New-MpwVerificationCheck -Id 'physicalPath' -Code 'PHYSICAL_PATH_MISMATCH' -Passed ($actualPhysicalPath -eq $expectedPhysicalPath) -Expected $expectedPhysicalPath -Actual $actualPhysicalPath),
            (New-MpwVerificationCheck -Id 'basicAuthentication' -Code 'IIS_AUTH_CONFIGURATION_MISMATCH' -Passed ([bool]$siteAfter.authentication.basicEnabled) -Expected $true -Actual ([bool]$siteAfter.authentication.basicEnabled)),
            (New-MpwVerificationCheck -Id 'anonymousDisabled' -Code 'IIS_AUTH_CONFIGURATION_MISMATCH' -Passed (-not [bool]$siteAfter.authentication.anonymousEnabled) -Expected $false -Actual ([bool]$siteAfter.authentication.anonymousEnabled)),
            (New-MpwVerificationCheck -Id 'sslControlPolicy' -Code 'IIS_AUTH_CONFIGURATION_MISMATCH' -Passed ([string]$siteAfter.ssl.controlChannelPolicy -eq 'SslAllow') -Expected 'SslAllow' -Actual ([ordered]@{ normalized = [string]$siteAfter.ssl.controlChannelPolicy; raw = [string]$siteAfter.ssl.rawControlChannelPolicy })),
            (New-MpwVerificationCheck -Id 'sslDataPolicy' -Code 'IIS_AUTH_CONFIGURATION_MISMATCH' -Passed ([string]$siteAfter.ssl.dataChannelPolicy -eq 'SslAllow') -Expected 'SslAllow' -Actual ([ordered]@{ normalized = [string]$siteAfter.ssl.dataChannelPolicy; raw = [string]$siteAfter.ssl.rawDataChannelPolicy })),
            (New-MpwVerificationCheck -Id 'authorization' -Code 'FTP_AUTHORIZATION_MISMATCH' -Passed ([bool]$authorizationOk) -Expected ([ordered]@{ username = [string]$options.Username; accessType = 'Allow'; permissions = 'Read, Write' }) -Actual @($siteAfter.authorization)),
            (New-MpwVerificationCheck -Id 'aclReadWrite' -Code 'FTP_ACCOUNT_PERMISSION_FAILED' -Passed ($aclAfter.readWriteAllowed -eq $true) -Expected $true -Actual $aclAfter),
            (New-MpwVerificationCheck -Id 'aclCanonical' -Code 'FTP_DIRECTORY_ACL_NONCANONICAL' -Passed ([bool]$aclDiagnosticsAfter.canonical) -Expected $true -Actual ([bool]$aclDiagnosticsAfter.canonical)),
            (New-MpwVerificationCheck -Id 'aclTightening' -Code 'FTP_DIRECTORY_ACL_TIGHTENING_MISMATCH' -Passed (-not $allowAclTightening -or $aclAfter.broadInheritedAccess -ne $true) -Expected (-not $allowAclTightening) -Actual ([bool]$aclAfter.broadInheritedAccess))
        )
        $failedVerificationChecks = @($verificationChecks | Where-Object { $_.passed -ne $true })
        if ($failedVerificationChecks.Count -gt 0) {
            $failedVerificationCodes = @($failedVerificationChecks | ForEach-Object { [string]$_.code } | Select-Object -Unique)
            $primaryVerificationCode = if ($failedVerificationCodes.Count -eq 1) { [string]$failedVerificationCodes[0] } else { 'FTP_CONFIGURATION_VERIFICATION_FAILED' }
            Throw-MpwFailure -Code $primaryVerificationCode -Message 'The final IIS FTP configuration did not pass verification.' -Command 'Microsoft.Web.Administration/GetAccessControl' -Details ([ordered]@{
                failedChecks = @($failedVerificationChecks | ForEach-Object { [string]$_.id })
                failedCodes = $failedVerificationCodes
                verificationChecks = @($verificationChecks)
                expected = [ordered]@{
                    managedSiteId = [long]$options.ManagedSiteId
                    binding = [string]$options.Binding
                    physicalPath = $expectedPhysicalPath
                    username = [string]$options.Username
                    basicAuthentication = $true
                    anonymousAuthentication = $false
                    sslPolicy = 'SslAllow'
                    aclReadWrite = $true
                    aclCanonical = $true
                    broadWriteRemoved = [bool]$allowAclTightening
                }
                actual = [ordered]@{
                    managedSiteId = [long]$siteAfter.id
                    bindings = @($siteAfter.bindings)
                    physicalPath = $actualPhysicalPath
                    authentication = $siteAfter.authentication
                    ssl = $siteAfter.ssl
                    authorization = @($siteAfter.authorization)
                    acl = $aclDiagnosticsAfter
                }
                technicalMessage = "Critical verification checks failed: $([string]::Join(', ', $failedVerificationCodes))."
            })
        }
        [void]$steps.Add([ordered]@{ name = 'verify'; status = 'success'; message = 'The final IIS FTP configuration passed verification.' })

        $systemStatus = Get-MpwElevatedSystemStatus -Options $options
        $systemVerificationChecks = @(
            (New-MpwVerificationCheck -Id 'ftpServiceFeature' -Code 'IIS_FTP_FEATURE_MISSING' -Passed ($systemStatus.windowsFeatures.ftpService.installed -eq $true) -Expected $true -Actual $systemStatus.windowsFeatures.ftpService),
            (New-MpwVerificationCheck -Id 'ftpExtensibilityFeature' -Code 'IIS_FTP_FEATURE_MISSING' -Passed ($systemStatus.windowsFeatures.ftpExtensibility.installed -eq $true) -Expected $true -Actual $systemStatus.windowsFeatures.ftpExtensibility),
            (New-MpwVerificationCheck -Id 'managementToolsFeature' -Code 'IIS_FTP_FEATURE_MISSING' -Passed ($systemStatus.windowsFeatures.managementTools.installed -eq $true) -Expected $true -Actual $systemStatus.windowsFeatures.managementTools),
            (New-MpwVerificationCheck -Id 'ftpServiceExists' -Code 'FTP_SERVICE_NOT_FOUND' -Passed ($systemStatus.service.exists -eq $true) -Expected $true -Actual $systemStatus.service),
            (New-MpwVerificationCheck -Id 'ftpServiceRunning' -Code 'FTP_SERVICE_NOT_RUNNING' -Passed ($systemStatus.service.running -eq $true) -Expected $true -Actual $systemStatus.service),
            (New-MpwVerificationCheck -Id 'siteManaged' -Code 'MANAGED_SITE_ID_MISMATCH' -Passed ($systemStatus.site.managed -eq $true) -Expected ([long]$options.ManagedSiteId) -Actual $systemStatus.site),
            (New-MpwVerificationCheck -Id 'siteStarted' -Code 'SITE_NOT_STARTED' -Passed ($systemStatus.site.started -eq $true) -Expected 'Started' -Actual ([string]$systemStatus.site.status)),
            (New-MpwVerificationCheck -Id 'binding' -Code 'SITE_BINDING_MISMATCH' -Passed ($systemStatus.binding.correct -eq $true) -Expected ([string]$options.Binding) -Actual $systemStatus.binding),
            (New-MpwVerificationCheck -Id 'authentication' -Code 'IIS_AUTH_CONFIGURATION_MISMATCH' -Passed ($systemStatus.authentication.correct -eq $true) -Expected ([ordered]@{ basicEnabled = $true; anonymousEnabled = $false }) -Actual $systemStatus.authentication),
            (New-MpwVerificationCheck -Id 'authorization' -Code 'FTP_AUTHORIZATION_MISMATCH' -Passed ($systemStatus.authorization.correct -eq $true) -Expected ([ordered]@{ username = [string]$options.Username; read = $true; write = $true }) -Actual $systemStatus.authorization),
            (New-MpwVerificationCheck -Id 'accountExists' -Code 'FTP_ACCOUNT_STATE_MISMATCH' -Passed ($systemStatus.account.exists -eq $true) -Expected $true -Actual $systemStatus.account),
            (New-MpwVerificationCheck -Id 'accountEnabled' -Code 'FTP_ACCOUNT_STATE_MISMATCH' -Passed ($systemStatus.account.enabled -eq $true) -Expected $true -Actual $systemStatus.account),
            (New-MpwVerificationCheck -Id 'accountManaged' -Code 'FTP_ACCOUNT_STATE_MISMATCH' -Passed ($systemStatus.account.managed -eq $true) -Expected $true -Actual $systemStatus.account),
            (New-MpwVerificationCheck -Id 'accountPasswordUpdated' -Code 'FTP_ACCOUNT_PASSWORD_UPDATE_FAILED' -Passed (-not $passwordSubmitted -or $accountResult.passwordReset -eq $true) -Expected $passwordSubmitted -Actual ([bool]$accountResult.passwordReset)),
            (New-MpwVerificationCheck -Id 'acl' -Code 'FTP_ACCOUNT_PERMISSION_FAILED' -Passed ($systemStatus.acl.correct -eq $true) -Expected $true -Actual $systemStatus.acl),
            (New-MpwVerificationCheck -Id 'aclTightening' -Code 'FTP_DIRECTORY_ACL_TIGHTENING_MISMATCH' -Passed (-not $allowAclTightening -or $systemStatus.acl.broadInheritedAccess -ne $true) -Expected (-not $allowAclTightening) -Actual ([bool]$systemStatus.acl.broadInheritedAccess)),
            (New-MpwVerificationCheck -Id 'passivePorts' -Code 'PASSIVE_PORT_MISMATCH' -Passed ($systemStatus.passivePorts.correct -eq $true) -Expected "$($options.PassivePortStart)-$($options.PassivePortEnd)" -Actual $systemStatus.passivePorts),
            (New-MpwVerificationCheck -Id 'firewall' -Code 'FIREWALL_RULE_MISMATCH' -Passed ($systemStatus.firewall.correct -eq $true) -Expected ([ordered]@{ controlPort = [int]$options.ControlPort; passivePorts = "$($options.PassivePortStart)-$($options.PassivePortEnd)"; remoteAddress = 'LocalSubnet' }) -Actual $systemStatus.firewall),
            (New-MpwVerificationCheck -Id 'listener' -Code 'CONTROL_PORT_NOT_LISTENING' -Passed ($systemStatus.port.listening -eq $true) -Expected ([int]$options.ControlPort) -Actual $systemStatus.port),
            (New-MpwVerificationCheck -Id 'listenerFtpServiceOwnership' -Code 'CONTROL_PORT_LISTENER_OWNERSHIP_MISMATCH' -Passed ($systemStatus.port.ownedByMicrosoftFtp -eq $true) -Expected 'FTPSVC' -Actual $systemStatus.port),
            (New-MpwVerificationCheck -Id 'listenerManagedSiteOwnership' -Code 'CONTROL_PORT_LISTENER_OWNERSHIP_MISMATCH' -Passed ($systemStatus.port.ownedByManagedSite -eq $true) -Expected ([long]$options.ManagedSiteId) -Actual $systemStatus.port),
            (New-MpwVerificationCheck -Id 'portConflict' -Code 'FTP_CONTROL_PORT_IN_USE' -Passed ($systemStatus.conflicts.portConflict -ne $true) -Expected $false -Actual $systemStatus.conflicts),
            (New-MpwVerificationCheck -Id 'siteConflict' -Code 'IIS_SITE_PORT_CONFLICT' -Passed ($systemStatus.conflicts.siteConflict -ne $true) -Expected $false -Actual $systemStatus.conflicts)
        )
        $failedSystemChecks = @($systemVerificationChecks | Where-Object { $_.passed -ne $true })
        if ($failedSystemChecks.Count -gt 0) {
            $failedSystemCodes = @($failedSystemChecks | ForEach-Object { [string]$_.code } | Select-Object -Unique)
            $primarySystemCode = if ($failedSystemCodes.Count -eq 1) { [string]$failedSystemCodes[0] } else { 'FTP_CONFIGURATION_VERIFICATION_FAILED' }
            Throw-MpwFailure -Code $primarySystemCode -Message 'The final elevated IIS FTP status did not pass all critical checks.' -Command 'Get-MpwElevatedSystemStatus' -Details ([ordered]@{
                failedChecks = @($failedSystemChecks | ForEach-Object { [string]$_.id })
                failedCodes = $failedSystemCodes
                verificationChecks = @($systemVerificationChecks)
                actual = $systemStatus
                technicalMessage = "Critical elevated status checks failed: $([string]::Join(', ', $failedSystemCodes))."
            })
        }
        $data = [ordered]@{
            action = $action
            status = 'success'
            message = if ($action -eq 'repair') { 'IIS FTP repair completed.' } else { 'IIS FTP setup completed.' }
            steps = @($steps)
            completedSteps = @($steps)
            warnings = @($warnings | ForEach-Object { [string]$_.message })
            requiresAdmin = $false
            siteId = [long]$options.ManagedSiteId
            managedSiteId = [long]$options.ManagedSiteId
            passwordReset = [bool]$accountResult.passwordReset
            aclTightening = $aclTighteningResult
            systemStatus = $systemStatus
            preflight = $preflight
            plan = $provisioningPlan
            verification = [ordered]@{
                configurationChecks = @($verificationChecks)
                systemChecks = @($systemVerificationChecks)
                failedCodes = @()
            }
            rollback = [ordered]@{ attempted = $false; status = 'not_required'; succeeded = $null; items = @(); warnings = @() }
        }
        $currentStage = 'completed'
        Write-MpwScriptResult -OutputPath $OutputPath -Action $action -Ok $true -Stage $currentStage -SiteName $options.SiteName -Data $data -Warnings @($warnings)
        return 0
    }
    catch {
        $failure = $_
        $rollbackWarnings = [Collections.Generic.List[object]]::new()
        $rollbackItems = [Collections.Generic.List[object]]::new()
        $rollbackAttempted = [bool](
            ($null -ne $manager -and (($siteCreated -and $commitAttempted) -or $null -ne $siteSnapshot)) -or
            $serviceMutationAttempted -or
            $null -ne $accountResult -or
            $null -ne $aclSnapshot -or
            $null -ne $controlFirewallResult -or
            $null -ne $passiveFirewallResult
        )
        if ($null -ne $manager -and (($siteCreated -and $commitAttempted) -or $null -ne $siteSnapshot)) {
            try {
                if ($siteCreated -and $null -ne $site) {
                    try { Stop-MpwSite -Site $site } catch {}
                    [void]$manager.Sites.Remove($site)
                }
                elseif ($null -ne $site -and $null -ne $siteSnapshot) {
                    Restore-MpwSiteSnapshot -Manager $manager -Site $site -Snapshot $siteSnapshot
                }
                if ($null -ne $passiveSnapshot) {
                    Set-MpwGlobalPassivePorts -Manager $manager -Start ([int]$passiveSnapshot.start) -End ([int]$passiveSnapshot.end)
                }
                $manager.CommitChanges()
                if (-not $siteCreated -and $null -ne $site -and $siteWasStarted) {
                    Start-MpwSite -Site $site
                }
                [void]$rollbackItems.Add([ordered]@{ resource = 'iis_site'; status = 'success'; message = 'The managed IIS FTP site and passive-port snapshot were restored.' })
            }
            catch {
                $rollbackWarning = [ordered]@{ code = 'IIS_ROLLBACK_FAILED'; message = 'The IIS site rollback did not fully complete.'; technicalMessage = [string]$_.Exception.Message; exceptionType = [string]$_.Exception.GetType().FullName }
                [void]$rollbackWarnings.Add($rollbackWarning)
                [void]$rollbackItems.Add([ordered]@{ resource = 'iis_site'; status = 'failed'; message = [string]$rollbackWarning.message; code = [string]$rollbackWarning.code })
            }
        }
        if ($serviceMutationAttempted -and $null -ne $serviceSnapshot) {
            try {
                $targetSiteId = if ($null -ne $options) { [long]$options.ManagedSiteId } else { 0 }
                $targetName = if ($null -ne $options) { [string]$options.SiteName } else { '' }
                $serviceRollback = Restore-MpwFtpServiceSnapshot -Snapshot $serviceSnapshot -Manager $manager -TargetSiteId $targetSiteId -TargetSiteName $targetName
                foreach ($serviceWarning in @($serviceRollback.warnings)) { [void]$rollbackWarnings.Add($serviceWarning) }
                $serviceRollbackStatus = if ($serviceRollback.succeeded) { 'success' } elseif ($serviceRollback.startupTypeRestored) { 'partial' } else { 'failed' }
                [void]$rollbackItems.Add([ordered]@{
                    resource = 'ftp_service'
                    status = $serviceRollbackStatus
                    message = if ($serviceRollback.succeeded) { 'The original FTPSVC startup type and running state were restored.' } else { 'FTPSVC rollback completed only partially; see rollback warnings.' }
                    startupTypeRestored = [bool]$serviceRollback.startupTypeRestored
                    runningStateRestored = [bool]$serviceRollback.runningStateRestored
                    runningStateAction = [string]$serviceRollback.runningStateAction
                    runningStateReason = [string]$serviceRollback.runningStateReason
                    otherStartedSites = @($serviceRollback.otherStartedSites)
                })
            }
            catch {
                $rollbackWarning = [ordered]@{ code = 'FTPSVC_ROLLBACK_FAILED'; message = 'The Microsoft FTP Service snapshot could not be restored.'; technicalMessage = [string]$_.Exception.Message; exceptionType = [string]$_.Exception.GetType().FullName }
                [void]$rollbackWarnings.Add($rollbackWarning)
                [void]$rollbackItems.Add([ordered]@{ resource = 'ftp_service'; status = 'failed'; message = [string]$rollbackWarning.message; code = [string]$rollbackWarning.code })
            }
        }
        foreach ($firewallResult in @($controlFirewallResult, $passiveFirewallResult)) {
            if ($null -eq $firewallResult) { continue }
            try {
                Restore-MpwFirewallRuleChange -Result $firewallResult
                [void]$rollbackItems.Add([ordered]@{ resource = 'firewall'; status = 'success'; message = 'A workbench FTP firewall rule snapshot was restored.' })
            }
            catch {
                $rollbackWarning = [ordered]@{ code = 'FIREWALL_ROLLBACK_FAILED'; message = 'A Windows Firewall FTP rule could not be fully restored.'; technicalMessage = [string]$_.Exception.Message; exceptionType = [string]$_.Exception.GetType().FullName }
                [void]$rollbackWarnings.Add($rollbackWarning)
                [void]$rollbackItems.Add([ordered]@{ resource = 'firewall'; status = 'failed'; message = [string]$rollbackWarning.message; code = [string]$rollbackWarning.code })
            }
        }
        $aclRollbackSucceeded = $null
        if ($null -ne $aclSnapshot -and $null -ne $options -and [IO.Directory]::Exists($options.PhysicalPath)) {
            try {
                $aclRollback = Restore-MpwDirectoryAclSnapshot -PhysicalPath $options.PhysicalPath -Snapshot $aclSnapshot
                $aclRollbackSucceeded = [bool]$aclRollback.succeeded
                [void]$rollbackItems.Add([ordered]@{
                    resource = 'directory_acl'
                    status = 'success'
                    message = 'The FTP directory ACL SDDL snapshot was restored and verified.'
                    protected = [bool]$aclRollback.protected
                    canonical = [bool]$aclRollback.canonical
                    ruleCount = [int]$aclRollback.ruleCount
                })
            }
            catch {
                $aclRollbackSucceeded = $false
                $aclRollbackDiagnostic = Get-MpwExceptionDiagnosticDetails -ErrorRecord $_
                $rollbackWarning = [ordered]@{
                    code = 'FTP_ACL_ROLLBACK_FAILED'
                    message = 'The FTP directory ACL could not be fully restored and verified.'
                    technicalMessage = [string]$aclRollbackDiagnostic.technicalMessage
                    exceptionType = [string]$aclRollbackDiagnostic.sourceExceptionType
                    hresult = [string]$aclRollbackDiagnostic.hresult
                    acl = Get-MpwDirectoryAclDiagnostics -PhysicalPath $options.PhysicalPath
                }
                [void]$rollbackWarnings.Add($rollbackWarning)
                [void]$rollbackItems.Add([ordered]@{ resource = 'directory_acl'; status = 'failed'; message = [string]$rollbackWarning.message; code = [string]$rollbackWarning.code })
            }
        }
        if ($null -ne $accountResult -and [bool]$accountResult.created -and $aclRollbackSucceeded -ne $false) {
            try {
                Remove-MpwManagedLocalAccount -Username ([string]$accountResult.username)
                [void]$rollbackItems.Add([ordered]@{ resource = 'account'; status = 'success'; message = 'The newly created managed FTP account was removed.' })
            }
            catch {
                $rollbackWarning = [ordered]@{ code = 'FTP_ACCOUNT_ROLLBACK_FAILED'; message = 'The newly created managed FTP account could not be rolled back.'; technicalMessage = [string]$_.Exception.Message; exceptionType = [string]$_.Exception.GetType().FullName }
                [void]$rollbackWarnings.Add($rollbackWarning)
                [void]$rollbackItems.Add([ordered]@{ resource = 'account'; status = 'failed'; message = [string]$rollbackWarning.message; code = [string]$rollbackWarning.code })
            }
        }
        elseif ($null -ne $accountResult -and [bool]$accountResult.created -and $aclRollbackSucceeded -eq $false) {
            # Keep the marked workbench account when its ACE could not be
            # removed safely. Deleting it here would turn the remaining ACE
            # into another orphan SID and make the next retry less reliable.
            $rollbackWarning = [ordered]@{
                code = 'FTP_ACCOUNT_ROLLBACK_DEFERRED'
                message = 'The newly created managed FTP account was retained because ACL rollback was incomplete; the next retry can safely reuse it.'
            }
            [void]$rollbackWarnings.Add($rollbackWarning)
            [void]$rollbackItems.Add([ordered]@{ resource = 'account'; status = 'partial'; message = [string]$rollbackWarning.message; code = [string]$rollbackWarning.code })
        }
        elseif ($null -ne $accountResult -and [bool]$accountResult.passwordReset) {
            $rollbackWarning = [ordered]@{ code = 'FTP_PASSWORD_ROLLBACK_UNAVAILABLE'; message = 'Windows does not expose the previous password; the password change itself cannot be reversed.' }
            [void]$rollbackWarnings.Add($rollbackWarning)
            [void]$rollbackItems.Add([ordered]@{ resource = 'account_password'; status = 'partial'; message = [string]$rollbackWarning.message; code = [string]$rollbackWarning.code })
        }
        $password = $null
        $safe = ConvertTo-MpwSafeException -ErrorRecord $failure
        $failedStep = [ordered]@{
            name = $currentStage
            status = 'failed'
            code = [string]$safe.code
            message = [string]$safe.message
        }
        $rollbackSucceeded = if ($rollbackAttempted) { $rollbackWarnings.Count -eq 0 } else { $null }
        $rollbackStatus = if (-not $rollbackAttempted) {
            'not_required'
        }
        elseif ($rollbackSucceeded) {
            'success'
        }
        elseif (@($rollbackItems | Where-Object { $_.status -eq 'success' -or $_.status -eq 'partial' }).Count -gt 0) {
            'partial'
        }
        else {
            'failed'
        }
        $rollback = [ordered]@{
            attempted = $rollbackAttempted
            status = $rollbackStatus
            succeeded = $rollbackSucceeded
            items = @($rollbackItems)
            warnings = @($rollbackWarnings)
        }
        $data = [ordered]@{
            action = $action
            status = 'failed'
            message = if ($rollbackAttempted) { 'The IIS FTP operation failed and rollback was attempted.' } else { 'The IIS FTP operation failed before system changes were attempted.' }
            steps = @($steps) + @($failedStep)
            completedSteps = @($steps)
            failedStep = $failedStep
            warnings = @($rollbackWarnings | ForEach-Object { [string]$_.message })
            requiresAdmin = $safe.code -eq 'ADMIN_REQUIRED'
            preflight = $preflight
            plan = $provisioningPlan
            rollback = $rollback
        }
        Write-MpwScriptResult -OutputPath $OutputPath -Action $action -Ok $false -Stage $currentStage -SiteName $(if ($null -ne $options) { $options.SiteName } else { '' }) -Data $data -ErrorObject $safe -Warnings @($rollbackWarnings) -RollbackAttempted $rollbackAttempted -RollbackSucceeded $rollbackSucceeded
        return (Get-MpwExitCode -Code ([string]$safe.code))
    }
    finally {
        $password = $null
        $inputObject = $null
        if ($null -ne $manager) { $manager.Dispose() }
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    exit (Invoke-MpwIisFtpSetup -InputPath $InputPath -OutputPath $OutputPath)
}
