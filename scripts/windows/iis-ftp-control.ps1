param(
    [string]$InputPath,
    [string]$OutputPath,
    [string]$StatusPath,
    [string]$OperationId
)

$commonPath = Join-Path $PSScriptRoot 'iis-ftp-common.ps1'
. $commonPath

function Invoke-MpwIisFtpControl {
    param(
        [Parameter(Mandatory = $true)][string]$InputPath,
        [Parameter(Mandatory = $true)][string]$OutputPath
    )

    $action = 'control'
    $manager = $null
    $site = $null
    $options = $null
    $siteSnapshot = $null
    $newPath = $null
    $setPathCommitted = $false
    $serviceSnapshot = $null
    $siteRuntimeSnapshot = $null
    $serviceMutationAttempted = $false
    $siteRuntimeMutationAttempted = $false
    $currentStage = 'read_input'
    $steps = [Collections.Generic.List[object]]::new()
    $warnings = [Collections.Generic.List[object]]::new()

    try {
        $currentStage = 'read_input'
        $inputObject = Read-MpwJsonInput -Path $InputPath -DeleteAfterRead
        $currentStage = 'validate_input'
        Assert-MpwAllowedInputProperties -InputObject $inputObject -AllowedProperties @((Get-MpwCommonInputProperties) + @('expectedCurrentPath'))
        $action = Assert-MpwAction -InputObject $inputObject -AllowedActions @('start', 'stop', 'restart', 'set-path', 'restore-path')
        $currentStage = 'check_permissions'
        Assert-MpwAdministrator
        $currentStage = 'validate_configuration'
        $options = Get-MpwNormalizedOptions -InputObject $inputObject -RequirePath:($action -eq 'set-path' -or $action -eq 'restore-path')

        if ($action -eq 'set-path') {
            $currentStage = 'prepare_target_directory'
            $newPath = Assert-MpwPhysicalPath -PhysicalPath $options.PhysicalPath
            $options.PhysicalPath = $newPath
            $account = Get-MpwLocalAccountStatus -Username $options.Username
            if ($account.exists -ne $true) {
                Throw-MpwFailure -Code 'FTP_ACCOUNT_NOT_FOUND' -Message 'The managed FTP account does not exist.'
            }
            if ($account.isManaged -ne $true) {
                Throw-MpwFailure -Code 'FTP_ACCOUNT_CONFLICT' -Message 'The configured FTP username is not owned by Media Photo Workbench.'
            }
        }

        if ($action -eq 'start' -or $action -eq 'restart') {
            $currentStage = 'preflight_port'
            $port = Get-MpwPortStatus -Port $options.ControlPort -PassiveStart $options.PassivePortStart -PassiveEnd $options.PassivePortEnd
            if ($port.reserved) {
                Throw-MpwFailure -Code 'FTP_CONTROL_PORT_RESERVED' -Message 'The configured FTP control port is reserved by Windows.' -Details ([ordered]@{ port = $options.ControlPort; source = 'windowsReservedPort'; reservedRange = [string]$port.reservedRange; canChangePort = $true; availablePorts = @($port.availablePorts); recommendation = 'Choose one of the available control ports.' })
            }
            if ($port.usedByOtherProcess) {
                Throw-MpwFailure -Code 'PORT_USED_BY_OTHER_PROCESS' -Message 'The configured FTP control port is owned by another process.' -Details ([ordered]@{ port = $options.ControlPort; source = 'process'; pid = $port.pid; processName = [string]$port.processName; canChangePort = $true; availablePorts = @($port.availablePorts); recommendation = 'Do not stop the other process automatically. Choose another available control port.' })
            }
        }

        $currentStage = 'inspect_iis_site'
        $manager = Open-MpwServerManager
        $site = $manager.Sites[$options.SiteName]
        if ($null -eq $site) {
            Throw-MpwFailure -Code 'IIS_SITE_NOT_FOUND' -Message 'The configured IIS FTP site was not found.'
        }
        if (-not (Test-MpwSiteManagedByAccount -Site $site -SiteName $options.SiteName -Username $options.Username -ManagedSiteId $options.ManagedSiteId)) {
            Throw-MpwFailure -Code 'MANAGED_SITE_ID_MISMATCH' -Message 'The configured IIS FTP site identity or managed account marker does not match.'
        }
        if ($action -eq 'restore-path') {
            $currentStage = 'validate_rollback_target'
            $newPath = Assert-MpwPhysicalPath -PhysicalPath $options.PhysicalPath -AllowMissing
            $expectedCurrentPath = [string](Get-MpwInputValue -InputObject $inputObject -Name 'expectedCurrentPath' -DefaultValue '')
            $expectedCurrentPath = Assert-MpwPhysicalPath -PhysicalPath $expectedCurrentPath
        }
        if ($action -ne 'stop') {
            $siteModelBefore = Get-MpwFtpSiteModel -Manager $manager -Site $site
            $matchingBinding = @($siteModelBefore.bindings | Where-Object { $_.protocol -eq 'ftp' -and $_.bindingInformation -eq $options.Binding })
            if ([string]$site.Name -ne [string]$options.SiteName -or $matchingBinding.Count -ne 1) {
                Throw-MpwFailure -Code 'SITE_BINDING_MISMATCH' -Message 'The IIS FTP site name or binding does not match workbench settings.'
            }
            if ($siteModelBefore.authentication.basicEnabled -ne $true -or $siteModelBefore.authentication.anonymousEnabled -ne $false -or
                [string]$siteModelBefore.ssl.controlChannelPolicy -ne 'SslAllow' -or [string]$siteModelBefore.ssl.dataChannelPolicy -ne 'SslAllow') {
                Throw-MpwFailure -Code 'IIS_AUTH_CONFIGURATION_MISMATCH' -Message 'FTP authentication or SSL settings must be corrected manually.'
            }
            $authorizationBefore = Get-MpwFtpAuthorizationEvaluation -Rules @($siteModelBefore.authorization) -Username $options.Username
            if (-not $authorizationBefore.correct) {
                Throw-MpwFailure -Code 'FTP_AUTHORIZATION_MISMATCH' -Message 'The managed IIS FTP authorization is incomplete or contains a deny rule that applies to the camera account.' -Details ([ordered]@{
                    managedAllow = [bool]$authorizationBefore.managedAllow
                    conflictingDeny = [bool]$authorizationBefore.conflictingDeny
                    conflicts = @($authorizationBefore.conflicts)
                    recommendation = 'Correct the FTP authorization rules manually using the built-in guide.'
                })
            }
        }
        if ($action -ne 'stop') {
            $otherPortSites = @(Find-MpwPortSites -Manager $manager -Port $options.ControlPort -ExcludeSiteName $options.SiteName)
            if ($otherPortSites.Count -gt 0) {
                Throw-MpwFailure -Code 'IIS_SITE_PORT_CONFLICT' -Message 'Another IIS FTP site uses the configured control port. It was not modified.' -Details ([ordered]@{ port = $options.ControlPort; source = 'iisSite'; canChangePort = $true; availablePorts = @(Get-MpwAvailableControlPorts -PreferredPort 21 -PassiveStart $options.PassivePortStart -PassiveEnd $options.PassivePortEnd -Count 5); recommendation = 'Choose another available control port.'; candidates = @($otherPortSites | ForEach-Object { [ordered]@{ siteName = $_.name; physicalPath = $_.physicalPath; bindings = $_.bindings; state = $_.state; adoptable = $false } }) })
            }
        }
        if ($action -eq 'start' -or $action -eq 'stop' -or $action -eq 'restart') {
            $siteRuntimeSnapshot = Get-MpwFtpSiteRuntimeState -Site $site
        }
        if ($action -eq 'start' -or $action -eq 'restart') {
            $currentStage = 'verify_active_event_directory'
            $expectedPath = Assert-MpwPhysicalPath -PhysicalPath $options.PhysicalPath
            $currentPath = Assert-MpwPhysicalPath -PhysicalPath ([string]$siteModelBefore.physicalPath)
            if ($currentPath.TrimEnd('\') -ne $expectedPath.TrimEnd('\')) {
                Throw-MpwFailure -Code 'PHYSICAL_PATH_MISMATCH' -Message 'The managed IIS FTP site points to a different activity directory. Switch the receiving activity first.'
            }
            $activeAcl = Get-MpwDirectoryAclStatus -PhysicalPath $currentPath -Username $options.Username
            if ($activeAcl.inheritedModifyAllowed -ne $true) {
                Throw-MpwFailure -Code 'FTP_DIRECTORY_PERMISSION_REQUIRED' -Message 'The active activity directory does not inherit effective Modify access for the managed FTP account.'
            }
            if ($action -eq 'restart' -and $siteRuntimeSnapshot -ne 'Started') {
                Throw-MpwFailure -Code 'FTP_SITE_NOT_RUNNING' -Message 'The managed IIS FTP site is not running; use Start instead of Restart.'
            }
            $ftpService = Get-MpwFtpServiceStatus
            if ($ftpService.exists -ne $true -or $ftpService.running -ne $true) {
                Throw-MpwFailure -Code 'FTP_SERVICE_NOT_RUNNING' -Message 'Start Microsoft FTP Service manually before controlling the workbench site.'
            }
        }
        [void]$steps.Add([ordered]@{ name = 'preflight'; status = 'success'; message = 'The IIS FTP site and requested action were validated.' })

        switch ($action) {
            'start' {
                $currentStage = 'start_ftp_site'
                $siteRuntimeMutationAttempted = $true
                Start-MpwSite -Site $site
                $currentStage = 'verify_ftp_listener'
                $listener = Wait-MpwPortListener -Port $options.ControlPort -PassiveStart $options.PassivePortStart -PassiveEnd $options.PassivePortEnd -TimeoutMilliseconds $script:MpwFtpListenerTimeoutMilliseconds
                if (-not $listener.listening -or $listener.usedByOtherProcess) {
                    Throw-MpwFailure -Code 'IIS_FTP_LISTENER_START_FAILED' -Message 'The IIS FTP site started but did not produce the expected Microsoft FTP Service listener.' -Command 'Get-NetTCPConnection' -Details ([ordered]@{ port = $options.ControlPort; siteName = $options.SiteName; siteState = Get-MpwFtpSiteRuntimeState -Site $site; listening = [bool]$listener.listening; pid = $listener.pid; processName = [string]$listener.processName; technicalMessage = "The configured control port did not become an FTPSVC listener within $([int]($script:MpwFtpListenerTimeoutMilliseconds / 1000)) seconds." })
                }
                [void]$steps.Add([ordered]@{ name = 'start'; status = 'success'; message = 'The IIS FTP site is running.' })
            }
            'stop' {
                $currentStage = 'stop_ftp_site'
                $siteRuntimeMutationAttempted = $true
                Stop-MpwSite -Site $site
                [void]$steps.Add([ordered]@{ name = 'stop'; status = 'success'; message = 'The IIS FTP site is stopped; the shared FTPSVC service was not stopped.' })
            }
            'restart' {
                $currentStage = 'stop_ftp_site'
                $siteRuntimeMutationAttempted = $true
                Stop-MpwSite -Site $site
                $currentStage = 'start_ftp_site'
                Start-MpwSite -Site $site
                $currentStage = 'verify_ftp_listener'
                $listener = Wait-MpwPortListener -Port $options.ControlPort -PassiveStart $options.PassivePortStart -PassiveEnd $options.PassivePortEnd -TimeoutMilliseconds $script:MpwFtpListenerTimeoutMilliseconds
                if (-not $listener.listening -or $listener.usedByOtherProcess) {
                    Throw-MpwFailure -Code 'IIS_FTP_LISTENER_START_FAILED' -Message 'The restarted IIS FTP site did not produce the expected Microsoft FTP Service listener.' -Command 'Get-NetTCPConnection' -Details ([ordered]@{ port = $options.ControlPort; siteName = $options.SiteName; siteState = Get-MpwFtpSiteRuntimeState -Site $site; listening = [bool]$listener.listening; pid = $listener.pid; processName = [string]$listener.processName; technicalMessage = "The configured control port did not become an FTPSVC listener within $([int]($script:MpwFtpListenerTimeoutMilliseconds / 1000)) seconds." })
                }
                [void]$steps.Add([ordered]@{ name = 'restart'; status = 'success'; message = 'The IIS FTP site restarted successfully.' })
            }
            'restore-path' {
                $currentStage = 'snapshot_current_state'
                $siteSnapshot = Get-MpwSiteSnapshot -Manager $manager -Site $site
                $siteRuntimeSnapshot = [string]$siteSnapshot.state
                $currentPath = [IO.Path]::GetFullPath([string]$siteSnapshot.physicalPath).TrimEnd('\')
                if ([string]$siteSnapshot.state -ne 'Stopped' -or $currentPath -ne $expectedCurrentPath.TrimEnd('\')) {
                    Throw-MpwFailure -Code 'FTP_SWITCH_ROLLBACK_FAILED' -Message 'The stopped managed site no longer matches the path-switch snapshot; no rollback change was made.'
                }
                $currentStage = 'rollback_physical_path'
                $site.Applications['/'].VirtualDirectories['/'].PhysicalPath = $newPath
                $manager.CommitChanges()
                $setPathCommitted = $true
                $restoredPath = [IO.Path]::GetFullPath([string](Get-MpwFtpSiteModel -Manager $manager -Site $site).physicalPath).TrimEnd('\')
                if ($restoredPath -ne $newPath.TrimEnd('\') -or (Get-MpwFtpSiteRuntimeState -Site $site) -ne 'Stopped') {
                    Throw-MpwFailure -Code 'FTP_SWITCH_ROLLBACK_FAILED' -Message 'The former physicalPath or stopped site state could not be verified.'
                }
                [void]$steps.Add([ordered]@{ name = 'rollback_physical_path'; status = 'success'; message = 'The stopped managed site path was restored to its captured value.' })
            }
            'set-path' {
                $currentStage = 'snapshot_current_state'
                $siteSnapshot = Get-MpwSiteSnapshot -Manager $manager -Site $site
                $siteWasStarted = [string]$siteSnapshot.state -eq 'Started'
                $siteRuntimeSnapshot = [string]$siteSnapshot.state
                if ($siteWasStarted) {
                    $ftpService = Get-MpwFtpServiceStatus
                    if ($ftpService.exists -ne $true -or $ftpService.running -ne $true) {
                        Throw-MpwFailure -Code 'FTP_SERVICE_NOT_RUNNING' -Message 'Start Microsoft FTP Service manually before switching the active activity.'
                    }
                }
                [void]$steps.Add([ordered]@{ name = 'snapshot_current_state'; status = 'success'; message = 'The current Site ID, physicalPath and runtime state were captured.' })

                $currentStage = 'verify_target_directory'
                $newPath = Assert-MpwPhysicalPath -PhysicalPath $newPath
                $targetAclStatus = Get-MpwDirectoryAclStatus -PhysicalPath $newPath -Username $options.Username
                if ($targetAclStatus.inheritedModifyAllowed -ne $true) {
                    Throw-MpwFailure -Code 'FTP_DIRECTORY_PERMISSION_REQUIRED' -Message 'The target directory does not inherit effective Modify access for the managed FTP account.' -Details ([ordered]@{
                        deniedModifyMask = $targetAclStatus.deniedModifyMask
                        effectivePrincipalSids = @($targetAclStatus.effectivePrincipalSids)
                        recommendation = 'Grant inheritable Modify permission on the workspace parent directory, then retry.'
                    })
                }
                [void]$steps.Add([ordered]@{ name = 'verify_target_directory'; status = 'success'; message = 'The existing target directory grants the FTP account access.' })

                if ($siteWasStarted) {
                    $currentStage = 'stop_ftp_site'
                    $siteRuntimeMutationAttempted = $true
                    Stop-MpwSite -Site $site
                    [void]$steps.Add([ordered]@{ name = 'stop_ftp_site'; status = 'success'; message = 'The managed FTP site was stopped before changing physicalPath.' })
                }

                $currentStage = 'update_iis_physical_path'
                $site.Applications['/'].VirtualDirectories['/'].PhysicalPath = $newPath
                $manager.CommitChanges()
                $setPathCommitted = $true
                [void]$steps.Add([ordered]@{ name = 'update_iis_physical_path'; status = 'success'; message = 'The managed IIS FTP physicalPath was committed.' })

                if ($siteWasStarted) {
                    $currentStage = 'restart_ftp_site'
                    Start-MpwSite -Site $site
                    [void]$steps.Add([ordered]@{ name = 'restart_ftp_site'; status = 'success'; message = 'The managed FTP site was restored to Started.' })
                }
                elseif ((Get-MpwFtpSiteRuntimeState -Site $site) -ne 'Stopped') {
                    $currentStage = 'preserve_stopped_site'
                    Stop-MpwSite -Site $site
                    [void]$steps.Add([ordered]@{ name = 'preserve_stopped_site'; status = 'success'; message = 'The managed FTP site remains Stopped.' })
                }

                $currentStage = 'verify_switched_state'
                $after = Get-MpwFtpSiteModel -Manager $manager -Site $site
                $aclAfter = Get-MpwDirectoryAclStatus -PhysicalPath $newPath -Username $options.Username
                $pathMatches = [IO.Path]::GetFullPath([string]$after.physicalPath).TrimEnd('\') -eq $newPath.TrimEnd('\')
                $stateMatches = if ($siteWasStarted) { (Get-MpwFtpSiteRuntimeState -Site $site) -eq 'Started' } else { (Get-MpwFtpSiteRuntimeState -Site $site) -eq 'Stopped' }
                $listenerMatches = $true
                if ($siteWasStarted) {
                    $listenerAfterPathSwitch = Wait-MpwPortListener -Port $options.ControlPort -PassiveStart $options.PassivePortStart -PassiveEnd $options.PassivePortEnd -TimeoutMilliseconds $script:MpwFtpListenerTimeoutMilliseconds
                    $listenerMatches = [bool]($listenerAfterPathSwitch.listening -and -not $listenerAfterPathSwitch.usedByOtherProcess)
                }
                if (-not $pathMatches -or -not $aclAfter.inheritedModifyAllowed -or -not $stateMatches -or -not $listenerMatches) {
                    Throw-MpwFailure -Code 'FTP_SWITCH_VERIFY_FAILED' -Message 'The IIS FTP physical path switch did not pass verification.' -Details ([ordered]@{
                        expected = [ordered]@{ physicalPath = $newPath; started = [bool]$siteWasStarted; aclReadWrite = $true; listener = [bool]$siteWasStarted }
                        actual = [ordered]@{ physicalPath = [string]$after.physicalPath; started = (Get-MpwFtpSiteRuntimeState -Site $site) -eq 'Started'; aclReadWrite = [bool]$aclAfter.inheritedModifyAllowed; listener = [bool]$listenerMatches }
                    })
                }
                [void]$steps.Add([ordered]@{ name = 'verify_switched_state'; status = 'success'; message = 'physicalPath, ACL, site state and listener match the target transaction.' })
            }
        }

        $currentStage = if ($action -eq 'set-path' -or $action -eq 'restore-path') { 'verify_switched_state' } else { 'verify_configuration' }
        $systemStatus = Get-MpwElevatedSystemStatus -Options $options
        $data = [ordered]@{
            action = $action
            status = 'success'
            message = 'The IIS FTP control operation completed.'
            steps = @($steps)
            warnings = @($warnings | ForEach-Object { [string]$_.message })
            requiresAdmin = $false
            siteId = [long]$systemStatus.site.id
            managedSiteId = [long]$options.ManagedSiteId
            previousSiteStarted = if ($null -ne $siteRuntimeSnapshot) { [string]$siteRuntimeSnapshot -eq 'Started' } else { $null }
            previousPhysicalPath = if ($null -ne $siteSnapshot) { [string]$siteSnapshot.physicalPath } else { $null }
            physicalPath = if ($action -eq 'set-path' -or $action -eq 'restore-path') { $newPath } else { [string]$systemStatus.site.physicalPath }
            systemStatus = $systemStatus
        }
        $currentStage = 'completed'
        Write-MpwScriptResult -OutputPath $OutputPath -Action $action -Ok $true -Stage $currentStage -SiteName $options.SiteName -Data $data -Warnings @($warnings)
        return 0
    }
    catch {
        $failure = $_
        $failedStage = $currentStage
        $rollbackWarnings = [Collections.Generic.List[object]]::new()
        $rollbackItems = [Collections.Generic.List[object]]::new()
        if (($action -eq 'set-path' -or $action -eq 'restore-path') -and $setPathCommitted -and $null -ne $manager -and $null -ne $site -and $null -ne $siteSnapshot) {
            $rollbackStage = 'rollback_physical_path'
            try {
                $oldWasStarted = [string]$siteSnapshot.state -eq 'Started'
                if ((Get-MpwFtpSiteRuntimeState -Site $site) -eq 'Started') { Stop-MpwSite -Site $site }
                $site.Applications['/'].VirtualDirectories['/'].PhysicalPath = [string]$siteSnapshot.physicalPath
                $manager.CommitChanges()
                $restoredPath = [IO.Path]::GetFullPath([string](Get-MpwFtpSiteModel -Manager $manager -Site $site).physicalPath).TrimEnd('\')
                $expectedOldPath = [IO.Path]::GetFullPath([string]$siteSnapshot.physicalPath).TrimEnd('\')
                if ($restoredPath -ne $expectedOldPath) {
                    Throw-MpwFailure -Code 'FTP_SWITCH_ROLLBACK_FAILED' -Message 'The previous IIS FTP physicalPath was not restored.'
                }
                [void]$rollbackItems.Add([ordered]@{ stage = 'rollback_physical_path'; status = 'success'; expected = $expectedOldPath; actual = $restoredPath })

                $rollbackStage = 'rollback_site_state'
                if ($oldWasStarted) {
                    Start-MpwSite -Site $site
                }
                elseif ((Get-MpwFtpSiteRuntimeState -Site $site) -ne 'Stopped') {
                    Stop-MpwSite -Site $site
                }
                $restoredState = Get-MpwFtpSiteRuntimeState -Site $site
                $expectedState = if ($oldWasStarted) { 'Started' } else { 'Stopped' }
                if ($restoredState -ne $expectedState) {
                    Throw-MpwFailure -Code 'FTP_SWITCH_ROLLBACK_FAILED' -Message 'The previous IIS FTP site state was not restored.'
                }
                [void]$rollbackItems.Add([ordered]@{ stage = 'rollback_site_state'; status = 'success'; expected = $expectedState; actual = $restoredState })
            }
            catch {
                [void]$rollbackItems.Add([ordered]@{ stage = $rollbackStage; status = 'failed'; code = 'FTP_SWITCH_ROLLBACK_FAILED'; message = [string]$_.Exception.Message })
                [void]$rollbackWarnings.Add([ordered]@{ code = 'FTP_SWITCH_ROLLBACK_FAILED'; message = 'The previous IIS FTP physical path or state could not be fully restored.'; technicalMessage = [string]$_.Exception.Message; exceptionType = [string]$_.Exception.GetType().FullName })
            }
        }
        elseif ($action -eq 'set-path' -or $action -eq 'restore-path') {
            [void]$rollbackItems.Add([ordered]@{ stage = 'rollback_physical_path'; status = 'not_required'; message = 'physicalPath was not committed.' })
            if (-not $siteRuntimeMutationAttempted) {
                [void]$rollbackItems.Add([ordered]@{ stage = 'rollback_site_state'; status = 'not_required'; message = 'The site runtime state was not changed.' })
            }
        }
        $requiresStandaloneRuntimeRollback = (
            $action -eq 'start' -or
            $action -eq 'stop' -or
            $action -eq 'restart' -or
            (($action -eq 'set-path' -or $action -eq 'restore-path') -and -not $setPathCommitted)
        )
        if ($requiresStandaloneRuntimeRollback -and $siteRuntimeMutationAttempted -and $null -ne $site -and $null -ne $siteRuntimeSnapshot) {
            try {
                $expectedRuntimeState = [string]$siteRuntimeSnapshot
                $currentRuntimeState = Get-MpwFtpSiteRuntimeState -Site $site
                if ($expectedRuntimeState -eq 'Started' -and $currentRuntimeState -ne 'Started') {
                    Start-MpwSite -Site $site
                }
                elseif ($expectedRuntimeState -eq 'Stopped' -and $currentRuntimeState -ne 'Stopped') {
                    Stop-MpwSite -Site $site
                }
                $restoredRuntimeState = Get-MpwFtpSiteRuntimeState -Site $site
                if ($restoredRuntimeState -ne $expectedRuntimeState) {
                    Throw-MpwFailure -Code 'FTP_SITE_RUNTIME_ROLLBACK_FAILED' -Message 'The managed FTP site runtime state could not be restored.'
                }
                [void]$rollbackItems.Add([ordered]@{ stage = 'rollback_site_state'; status = 'success'; expected = $expectedRuntimeState; actual = $restoredRuntimeState })
            }
            catch {
                [void]$rollbackItems.Add([ordered]@{ stage = 'rollback_site_state'; status = 'failed'; code = 'FTP_SITE_RUNTIME_ROLLBACK_FAILED'; message = [string]$_.Exception.Message })
                [void]$rollbackWarnings.Add([ordered]@{ code = 'FTP_SITE_RUNTIME_ROLLBACK_FAILED'; message = 'The managed FTP site runtime state could not be fully restored.'; technicalMessage = [string]$_.Exception.Message })
            }
        }
        $safe = ConvertTo-MpwSafeException -ErrorRecord $failure
        if ($action -eq 'set-path') {
            switch ($failedStage) {
                'stop_ftp_site' { $safe.code = 'FTP_SITE_STOP_FAILED' }
                'update_iis_physical_path' { $safe.code = 'FTP_PHYSICAL_PATH_UPDATE_FAILED' }
                'restart_ftp_site' { $safe.code = 'FTP_SITE_RESTART_FAILED' }
                'verify_switched_state' { $safe.code = 'FTP_SWITCH_VERIFY_FAILED' }
            }
        }
        $rollbackAttempted = [bool](
            ($action -eq 'set-path' -and ($setPathCommitted -or $siteRuntimeMutationAttempted)) -or
            (($action -eq 'start' -or $action -eq 'stop' -or $action -eq 'restart') -and $siteRuntimeMutationAttempted)
        )
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
        $data = [ordered]@{
            action = $action
            status = 'failed'
            message = 'The IIS FTP control operation failed; rollback was attempted when applicable.'
            steps = @($steps)
            warnings = @($rollbackWarnings | ForEach-Object { [string]$_.message })
            requiresAdmin = $safe.code -eq 'ADMIN_REQUIRED'
            previousPhysicalPath = if ($null -ne $siteSnapshot) { [string]$siteSnapshot.physicalPath } else { $null }
            rollback = [ordered]@{
                attempted = $rollbackAttempted
                status = $rollbackStatus
                succeeded = $rollbackSucceeded
                items = @($rollbackItems)
            }
        }
        Write-MpwScriptResult -OutputPath $OutputPath -Action $action -Ok $false -Stage $failedStage -SiteName $(if ($null -ne $options) { $options.SiteName } else { '' }) -Data $data -ErrorObject $safe -Warnings @($rollbackWarnings) -RollbackAttempted $rollbackAttempted -RollbackSucceeded $rollbackSucceeded
        return (Get-MpwExitCode -Code ([string]$safe.code))
    }
    finally {
        if ($null -ne $manager) { $manager.Dispose() }
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    exit (Invoke-MpwIisFtpControl -InputPath $InputPath -OutputPath $OutputPath)
}
