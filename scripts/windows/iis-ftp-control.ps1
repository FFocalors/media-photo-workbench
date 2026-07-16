param(
    [string]$InputPath,
    [string]$OutputPath
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
    $newAclSnapshot = $null
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
        Assert-MpwAllowedInputProperties -InputObject $inputObject -AllowedProperties @(Get-MpwCommonInputProperties)
        $action = Assert-MpwAction -InputObject $inputObject -AllowedActions @('start', 'stop', 'restart', 'set-path')
        $currentStage = 'check_permissions'
        Assert-MpwAdministrator
        $currentStage = 'validate_configuration'
        $options = Get-MpwNormalizedOptions -InputObject $inputObject -RequirePath:($action -eq 'set-path')

        if ($action -eq 'set-path') {
            $currentStage = 'prepare_target_directory'
            $newPath = Assert-MpwPhysicalPath -PhysicalPath $options.PhysicalPath -AllowMissing
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
            Throw-MpwFailure -Code 'IIS_SITE_ADOPTION_REQUIRED' -Message 'The configured IIS FTP site identity, managed account marker, or authorization does not match and cannot be controlled before explicit adoption.'
        }
        if ($action -ne 'stop') {
            $otherPortSites = @(Find-MpwPortSites -Manager $manager -Port $options.ControlPort -ExcludeSiteName $options.SiteName)
            if ($otherPortSites.Count -gt 0) {
                Throw-MpwFailure -Code 'IIS_SITE_PORT_CONFLICT' -Message 'Another IIS FTP site uses the configured control port. It was not modified.' -Details ([ordered]@{ port = $options.ControlPort; source = 'iisSite'; canChangePort = $true; availablePorts = @(Get-MpwAvailableControlPorts -PreferredPort 21 -PassiveStart $options.PassivePortStart -PassiveEnd $options.PassivePortEnd -Count 5); recommendation = 'Choose another available control port.'; candidates = @($otherPortSites | ForEach-Object { [ordered]@{ siteName = $_.name; physicalPath = $_.physicalPath; bindings = $_.bindings; state = $_.state; adoptable = $false } }) })
            }
        }
        if ($action -eq 'start' -or $action -eq 'restart') {
            $serviceSnapshot = Get-MpwFtpServiceStatus
            $siteRuntimeSnapshot = Get-MpwFtpSiteRuntimeState -Site $site
        }
        [void]$steps.Add([ordered]@{ name = 'preflight'; status = 'success'; message = 'The IIS FTP site and requested action were validated.' })

        switch ($action) {
            'start' {
                $currentStage = 'start_ftp_service'
                $serviceMutationAttempted = $true
                Start-MpwFtpService
                $currentStage = 'start_ftp_site'
                $siteRuntimeMutationAttempted = $true
                Start-MpwSite -Site $site
                $currentStage = 'verify_ftp_listener'
                $listener = Wait-MpwPortListener -Port $options.ControlPort -PassiveStart $options.PassivePortStart -PassiveEnd $options.PassivePortEnd -TimeoutMilliseconds 5000
                if (-not $listener.listening -or $listener.usedByOtherProcess) {
                    Throw-MpwFailure -Code 'IIS_FTP_LISTENER_START_FAILED' -Message 'The IIS FTP site started but did not produce the expected Microsoft FTP Service listener.' -Command 'Get-NetTCPConnection' -Details ([ordered]@{ port = $options.ControlPort; siteName = $options.SiteName; siteState = Get-MpwFtpSiteRuntimeState -Site $site; listening = [bool]$listener.listening; pid = $listener.pid; processName = [string]$listener.processName; technicalMessage = 'The configured control port did not become an FTPSVC listener within 5 seconds.' })
                }
                [void]$steps.Add([ordered]@{ name = 'start'; status = 'success'; message = 'The IIS FTP site is running.' })
            }
            'stop' {
                $currentStage = 'stop_ftp_site'
                Stop-MpwSite -Site $site
                [void]$steps.Add([ordered]@{ name = 'stop'; status = 'success'; message = 'The IIS FTP site is stopped; the shared FTPSVC service was not stopped.' })
            }
            'restart' {
                $currentStage = 'stop_ftp_site'
                $siteRuntimeMutationAttempted = $true
                Stop-MpwSite -Site $site
                $currentStage = 'start_ftp_service'
                $serviceMutationAttempted = $true
                Start-MpwFtpService
                $currentStage = 'start_ftp_site'
                Start-MpwSite -Site $site
                $currentStage = 'verify_ftp_listener'
                $listener = Wait-MpwPortListener -Port $options.ControlPort -PassiveStart $options.PassivePortStart -PassiveEnd $options.PassivePortEnd -TimeoutMilliseconds 5000
                if (-not $listener.listening -or $listener.usedByOtherProcess) {
                    Throw-MpwFailure -Code 'IIS_FTP_LISTENER_START_FAILED' -Message 'The restarted IIS FTP site did not produce the expected Microsoft FTP Service listener.' -Command 'Get-NetTCPConnection' -Details ([ordered]@{ port = $options.ControlPort; siteName = $options.SiteName; siteState = Get-MpwFtpSiteRuntimeState -Site $site; listening = [bool]$listener.listening; pid = $listener.pid; processName = [string]$listener.processName; technicalMessage = 'The configured control port did not become an FTPSVC listener within 5 seconds.' })
                }
                [void]$steps.Add([ordered]@{ name = 'restart'; status = 'success'; message = 'The IIS FTP site restarted successfully.' })
            }
            'set-path' {
                $currentStage = 'snapshot_current_state'
                $siteSnapshot = Get-MpwSiteSnapshot -Manager $manager -Site $site
                $siteWasStarted = [string]$siteSnapshot.state -eq 'Started'
                if ([IO.Directory]::Exists($newPath)) {
                    $newAclSnapshot = Get-MpwDirectoryAclSnapshot -PhysicalPath $newPath
                }
                [void]$steps.Add([ordered]@{ name = 'snapshot_current_state'; status = 'success'; message = 'The current Site ID, physicalPath and runtime state were captured.' })

                $currentStage = 'prepare_target_directory'
                $newPath = Assert-MpwPhysicalPath -PhysicalPath $newPath -Create
                [void]$steps.Add([ordered]@{ name = 'prepare_target_directory'; status = 'success'; message = 'The target camera FTP original directory is ready.' })

                $currentStage = 'update_target_acl'
                [void](Grant-MpwDirectoryAccess -PhysicalPath $newPath -Username $options.Username)
                [void]$steps.Add([ordered]@{ name = 'update_target_acl'; status = 'success'; message = 'The managed FTP account has verified access to the target directory.' })

                if ($siteWasStarted) {
                    $currentStage = 'stop_ftp_site'
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
                    Start-MpwFtpService
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
                    $listenerAfterPathSwitch = Wait-MpwPortListener -Port $options.ControlPort -PassiveStart $options.PassivePortStart -PassiveEnd $options.PassivePortEnd -TimeoutMilliseconds 15000
                    $listenerMatches = [bool]($listenerAfterPathSwitch.listening -and -not $listenerAfterPathSwitch.usedByOtherProcess)
                }
                if (-not $pathMatches -or -not $aclAfter.readWriteAllowed -or -not $stateMatches -or -not $listenerMatches) {
                    Throw-MpwFailure -Code 'FTP_SWITCH_VERIFY_FAILED' -Message 'The IIS FTP physical path switch did not pass verification.' -Details ([ordered]@{
                        expected = [ordered]@{ physicalPath = $newPath; started = [bool]$siteWasStarted; aclReadWrite = $true; listener = [bool]$siteWasStarted }
                        actual = [ordered]@{ physicalPath = [string]$after.physicalPath; started = (Get-MpwFtpSiteRuntimeState -Site $site) -eq 'Started'; aclReadWrite = [bool]$aclAfter.readWriteAllowed; listener = [bool]$listenerMatches }
                    })
                }
                [void]$steps.Add([ordered]@{ name = 'verify_switched_state'; status = 'success'; message = 'physicalPath, ACL, site state and listener match the target transaction.' })
            }
        }

        $currentStage = if ($action -eq 'set-path') { 'verify_switched_state' } else { 'verify_configuration' }
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
            previousPhysicalPath = if ($null -ne $siteSnapshot) { [string]$siteSnapshot.physicalPath } else { $null }
            physicalPath = if ($action -eq 'set-path') { $newPath } else { [string]$systemStatus.site.physicalPath }
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
        if ($action -eq 'set-path' -and $setPathCommitted -and $null -ne $manager -and $null -ne $site -and $null -ne $siteSnapshot) {
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
                    Start-MpwFtpService
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
        elseif ($action -eq 'set-path') {
            [void]$rollbackItems.Add([ordered]@{ stage = 'rollback_physical_path'; status = 'not_required'; message = 'physicalPath was not committed.' })
            [void]$rollbackItems.Add([ordered]@{ stage = 'rollback_site_state'; status = 'not_required'; message = 'The site state was not changed.' })
        }
        if (($action -eq 'start' -or $action -eq 'restart') -and $siteRuntimeMutationAttempted -and $null -ne $site -and $null -ne $siteRuntimeSnapshot) {
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
        if (($action -eq 'start' -or $action -eq 'restart') -and $serviceMutationAttempted -and $null -ne $serviceSnapshot) {
            try {
                $serviceRollback = Restore-MpwFtpServiceSnapshot -Snapshot $serviceSnapshot -Manager $manager -TargetSiteId ([long]$site.Id) -TargetSiteName $options.SiteName
                foreach ($serviceWarning in @($serviceRollback.warnings)) { [void]$rollbackWarnings.Add($serviceWarning) }
                [void]$rollbackItems.Add([ordered]@{
                    stage = 'rollback_ftp_service'
                    status = if ($serviceRollback.succeeded) { 'success' } else { 'partial' }
                    code = if ($serviceRollback.succeeded) { $null } else { 'FTPSVC_ROLLBACK_PARTIAL' }
                    message = if ($serviceRollback.succeeded) { 'The original FTPSVC startup type and running state were restored.' } else { 'FTPSVC rollback was only partially completed; shared IIS FTP sites were preserved.' }
                })
            }
            catch {
                [void]$rollbackItems.Add([ordered]@{ stage = 'rollback_ftp_service'; status = 'failed'; code = 'FTPSVC_ROLLBACK_FAILED'; message = [string]$_.Exception.Message })
                [void]$rollbackWarnings.Add([ordered]@{ code = 'FTPSVC_ROLLBACK_FAILED'; message = 'The Microsoft FTP Service snapshot could not be restored.'; technicalMessage = [string]$_.Exception.Message })
            }
        }
        if ($null -ne $newAclSnapshot -and -not [string]::IsNullOrWhiteSpace($newPath) -and [IO.Directory]::Exists($newPath)) {
            try {
                $aclRollback = Restore-MpwDirectoryAclSnapshot -PhysicalPath $newPath -Snapshot $newAclSnapshot
                if (-not $aclRollback.succeeded) {
                    Throw-MpwFailure -Code 'FTP_ACL_ROLLBACK_VERIFY_FAILED' -Message 'The target directory ACL rollback did not pass SDDL verification.'
                }
                [void]$rollbackItems.Add([ordered]@{ stage = 'rollback_target_acl'; status = 'success'; message = 'The target directory ACL snapshot was restored and verified.' })
            }
            catch {
                $aclRollbackCode = if ($_.Exception.Data.Contains('MpwCode')) { [string]$_.Exception.Data['MpwCode'] } else { 'FTP_ACL_ROLLBACK_FAILED' }
                [void]$rollbackItems.Add([ordered]@{ stage = 'rollback_target_acl'; status = 'failed'; code = $aclRollbackCode; message = [string]$_.Exception.Message })
                [void]$rollbackWarnings.Add([ordered]@{ code = $aclRollbackCode; message = 'The target FTP directory ACL could not be restored and verified.' })
            }
        }
        $safe = ConvertTo-MpwSafeException -ErrorRecord $failure
        if ($action -eq 'set-path') {
            switch ($failedStage) {
                'stop_ftp_site' { $safe.code = 'FTP_SITE_STOP_FAILED' }
                'update_target_acl' { $safe.code = 'FTP_TARGET_ACL_UPDATE_FAILED' }
                'update_iis_physical_path' { $safe.code = 'FTP_PHYSICAL_PATH_UPDATE_FAILED' }
                'restart_ftp_site' { $safe.code = 'FTP_SITE_RESTART_FAILED' }
                'verify_switched_state' { $safe.code = 'FTP_SWITCH_VERIFY_FAILED' }
            }
        }
        $rollbackAttempted = [bool](
            ($action -eq 'set-path' -and ($setPathCommitted -or $null -ne $newAclSnapshot)) -or
            (($action -eq 'start' -or $action -eq 'restart') -and ($siteRuntimeMutationAttempted -or $serviceMutationAttempted))
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
