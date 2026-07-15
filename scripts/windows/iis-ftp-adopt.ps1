param(
    [string]$InputPath,
    [string]$OutputPath
)

$commonPath = Join-Path $PSScriptRoot 'iis-ftp-common.ps1'
. $commonPath

function Invoke-MpwIisFtpAdopt {
    param(
        [Parameter(Mandatory = $true)][string]$InputPath,
        [Parameter(Mandatory = $true)][string]$OutputPath
    )

    $action = 'adopt'
    $password = $null
    $manager = $null
    $site = $null
    $siteSnapshot = $null
    $passiveSnapshot = $null
    $aclSnapshot = $null
    $accountResult = $null
    $controlFirewallResult = $null
    $passiveFirewallResult = $null
    $options = $null
    $physicalPath = $null
    $siteWasStarted = $false
    $siteStoppedForChange = $false
    $currentStage = 'read_input'
    $steps = [Collections.Generic.List[object]]::new()
    $warnings = [Collections.Generic.List[object]]::new()

    try {
        $currentStage = 'read_input'
        $inputObject = Read-MpwJsonInput -Path $InputPath -DeleteAfterRead
        $currentStage = 'validate_input'
        Assert-MpwAllowedInputProperties -InputObject $inputObject -AllowedProperties @((Get-MpwCommonInputProperties) + @('password', 'targetSiteName'))
        $action = Assert-MpwAction -InputObject $inputObject -AllowedActions @('adopt')
        $currentStage = 'check_permissions'
        Assert-MpwAdministrator
        if ($env:OS -ne 'Windows_NT' -or [Environment]::OSVersion.Version.Build -lt 22000) {
            Throw-MpwFailure -Code 'UNSUPPORTED_PLATFORM' -Message 'IIS FTP adoption is supported only on Windows 11.'
        }

        $currentStage = 'validate_configuration'
        $options = Get-MpwNormalizedOptions -InputObject $inputObject -RequirePath
        $targetSiteName = Assert-MpwSiteName -SiteName ([string](Get-MpwInputValue -InputObject $inputObject -Name 'targetSiteName' -DefaultValue ''))
        $options.SiteName = $targetSiteName
        $physicalPath = Assert-MpwPhysicalPath -PhysicalPath $options.PhysicalPath -AllowMissing
        $options.PhysicalPath = $physicalPath
        if (Test-MpwInputProperty -InputObject $inputObject -Name 'password') {
            $password = Assert-MpwPassword -Password (Get-MpwInputValue -InputObject $inputObject -Name 'password')
        }

        $currentStage = 'preflight_account'
        $accountBefore = Get-MpwLocalAccountStatus -Username $options.Username
        if ($accountBefore.exists -eq $true -and $accountBefore.isManaged -ne $true) {
            Throw-MpwFailure -Code 'FTP_ACCOUNT_CONFLICT' -Message 'The requested local username is already owned by a non-managed Windows account.'
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
        [void]$steps.Add([ordered]@{ name = 'preflight'; status = 'success'; message = 'The explicit adoption request, account, path, and port were validated.' })

        $currentStage = 'enable_iis_features'
        $featureResult = Enable-MpwRequiredWindowsFeatures
        if ($featureResult.restartRequired) {
            [void]$warnings.Add([ordered]@{ code = 'WINDOWS_RESTART_REQUIRED'; message = 'Windows reports that a restart may be required before IIS FTP is fully available.' })
        }
        [void]$steps.Add([ordered]@{ name = 'windowsFeatures'; status = 'success'; message = 'Required IIS FTP feature state was reconciled.' })

        $currentStage = 'inspect_iis_sites'
        $manager = Open-MpwServerManager
        $site = $manager.Sites[$targetSiteName]
        if ($null -eq $site) {
            Throw-MpwFailure -Code 'IIS_SITE_NOT_FOUND' -Message 'The IIS FTP site selected for adoption was not found.'
        }
        $ftpBindings = @($site.Bindings | Where-Object { $_.Protocol -eq 'ftp' })
        if ($ftpBindings.Count -eq 0) {
            Throw-MpwFailure -Code 'IIS_SITE_CONFLICT' -Message 'The selected IIS site is not an FTP site.'
        }
        $otherPortSites = @(Find-MpwPortSites -Manager $manager -Port $options.ControlPort -ExcludeSiteName $targetSiteName)
        if ($otherPortSites.Count -gt 0) {
            Throw-MpwFailure -Code 'IIS_SITE_PORT_CONFLICT' -Message 'Another IIS FTP site also uses the configured control port and was not modified.' -Details ([ordered]@{
                port = $options.ControlPort
                source = 'iisSite'
                canChangePort = $true
                availablePorts = @(Get-MpwAvailableControlPorts -PreferredPort 21 -PassiveStart $options.PassivePortStart -PassiveEnd $options.PassivePortEnd -Count 5)
                recommendation = 'Choose another available control port.'
                candidates = @($otherPortSites | ForEach-Object { [ordered]@{ siteName = $_.name; physicalPath = $_.physicalPath; bindings = $_.bindings; state = $_.state; adoptable = $false } })
            })
        }

        $siteSnapshot = Get-MpwSiteSnapshot -Manager $manager -Site $site
        $passiveSnapshot = Get-MpwGlobalPassivePorts -Manager $manager
        $siteWasStarted = [string]$siteSnapshot.state -eq 'Started'
        if ([IO.Directory]::Exists($physicalPath)) {
            $aclSnapshot = [IO.Directory]::GetAccessControl($physicalPath)
        }
        $currentStage = 'prepare_receive_directory'
        $physicalPath = Assert-MpwPhysicalPath -PhysicalPath $physicalPath -Create
        $options.PhysicalPath = $physicalPath

        $currentStage = 'configure_local_account'
        $accountResult = Ensure-MpwManagedLocalAccount -Username $options.Username -Password $password
        $password = $null
        $currentStage = 'configure_directory_acl'
        [void](Grant-MpwDirectoryAccess -PhysicalPath $physicalPath -Username $options.Username)
        [void]$steps.Add([ordered]@{ name = 'accountAndAcl'; status = 'success'; message = 'The managed FTP account and target receive directory ACL are ready.' })

        if ($siteWasStarted) {
            Stop-MpwSite -Site $site
            $siteStoppedForChange = $true
        }
        $currentStage = 'configure_iis_site'
        Set-MpwFtpSiteConfiguration -Manager $manager -Site $site -PhysicalPath $physicalPath -Username $options.Username -Binding $options.Binding
        $currentStage = 'configure_passive_ports'
        Set-MpwGlobalPassivePorts -Manager $manager -Start $options.PassivePortStart -End $options.PassivePortEnd
        $currentStage = 'commit_iis_configuration'
        $manager.CommitChanges()
        $committedSite = $manager.Sites[$targetSiteName]
        if ($null -eq $committedSite -or [long]$committedSite.Id -le 0) {
            Throw-MpwFailure -Code 'IIS_SITE_ADOPTION_FAILED' -Message 'The adopted IIS FTP site identity could not be confirmed.'
        }
        $site = $committedSite
        $options.ManagedSiteId = [long]$site.Id
        [void]$steps.Add([ordered]@{ name = 'adoptSite'; status = 'success'; message = 'The selected site was adopted without renaming it or deleting its previous root.' })

        $currentStage = 'configure_firewall'
        $controlFirewallResult = Ensure-MpwFirewallRule -Kind control -DisplayName $options.FirewallControlRuleName -LocalPort ([string]$options.ControlPort) -AllowLegacyRuleUpdate $options.AllowLegacyFirewallRuleUpdate
        $passiveFirewallResult = Ensure-MpwFirewallRule -Kind passive -DisplayName $options.FirewallPassiveRuleName -LocalPort "$($options.PassivePortStart)-$($options.PassivePortEnd)" -AllowLegacyRuleUpdate $options.AllowLegacyFirewallRuleUpdate
        [void]$steps.Add([ordered]@{ name = 'firewall'; status = 'success'; message = 'Windows Firewall allows FTP control and passive traffic from LocalSubnet.' })

        $currentStage = 'start_ftp_service'
        Start-MpwFtpService
        $currentStage = 'start_ftp_site'
        Start-MpwSite -Site $site
        $currentStage = 'verify_ftp_listener'
        $listener = Wait-MpwPortListener -Port $options.ControlPort -PassiveStart $options.PassivePortStart -PassiveEnd $options.PassivePortEnd -TimeoutMilliseconds 5000
        if (-not $listener.listening -or $listener.usedByOtherProcess) {
            Throw-MpwFailure -Code 'IIS_FTP_LISTENER_START_FAILED' -Message 'The adopted IIS FTP site started but did not produce the expected Microsoft FTP Service listener.' -Command 'Get-NetTCPConnection' -Details ([ordered]@{
                port = $options.ControlPort
                siteName = $targetSiteName
                siteState = Get-MpwFtpSiteRuntimeState -Site $site
                listening = [bool]$listener.listening
                pid = $listener.pid
                processName = [string]$listener.processName
                technicalMessage = 'The configured control port did not become an FTPSVC listener within 5 seconds.'
            })
        }

        $currentStage = 'verify_configuration'
        $siteAfter = Get-MpwFtpSiteModel -Manager $manager -Site $site
        $aclAfter = Get-MpwDirectoryAclStatus -PhysicalPath $physicalPath -Username $options.Username
        $authorizationOk = @($siteAfter.authorization | Where-Object { $_.accessType -eq 'Allow' -and $_.users -eq $options.Username -and $_.permissions -match 'Read' -and $_.permissions -match 'Write' }).Count -gt 0
        $bindingOk = @($siteAfter.bindings | Where-Object { $_.protocol -eq 'ftp' -and $_.bindingInformation -eq $options.Binding }).Count -eq 1
        if ([long]$siteAfter.id -ne $options.ManagedSiteId -or
            -not $bindingOk -or
            [IO.Path]::GetFullPath([string]$siteAfter.physicalPath).TrimEnd('\') -ne $physicalPath.TrimEnd('\') -or
            -not $siteAfter.authentication.basicEnabled -or
            $siteAfter.authentication.anonymousEnabled -or
            $siteAfter.ssl.controlChannelPolicy -ne 'SslAllow' -or
            $siteAfter.ssl.dataChannelPolicy -ne 'SslAllow' -or
            -not $authorizationOk -or
            -not $aclAfter.readWriteAllowed) {
            Throw-MpwFailure -Code 'IIS_SITE_ADOPTION_FAILED' -Message 'The adopted IIS FTP site did not pass final configuration verification.'
        }
        [void]$steps.Add([ordered]@{ name = 'verify'; status = 'success'; message = 'The adopted IIS FTP site passed binding, path, auth, ACL, firewall, passive-port, and listener verification.' })

        $systemStatus = Get-MpwElevatedSystemStatus -Options $options
        if ($systemStatus.site.managed -ne $true -or $systemStatus.site.started -ne $true -or $systemStatus.binding.correct -ne $true -or $systemStatus.authentication.correct -ne $true -or $systemStatus.authorization.correct -ne $true -or $systemStatus.acl.correct -ne $true -or $systemStatus.passivePorts.correct -ne $true -or $systemStatus.firewall.correct -ne $true -or $systemStatus.port.listening -ne $true -or $systemStatus.port.ownedByManagedSite -ne $true -or $systemStatus.conflicts.portConflict -eq $true -or $systemStatus.conflicts.siteConflict -eq $true) {
            Throw-MpwFailure -Code 'IIS_SITE_ADOPTION_FAILED' -Message 'The final elevated IIS FTP status did not pass all critical checks.'
        }
        $data = [ordered]@{
            action = $action
            status = 'success'
            message = 'The existing IIS FTP site was adopted successfully.'
            steps = @($steps)
            warnings = @($warnings | ForEach-Object { [string]$_.message })
            requiresAdmin = $false
            siteName = $targetSiteName
            siteId = [long]$options.ManagedSiteId
            managedSiteId = [long]$options.ManagedSiteId
            previousSite = [ordered]@{
                id = [long]$siteSnapshot.id
                physicalPath = [string]$siteSnapshot.physicalPath
                bindings = @($siteSnapshot.bindings)
                state = [string]$siteSnapshot.state
            }
            passwordReset = [bool]$accountResult.passwordReset
            systemStatus = $systemStatus
        }
        $currentStage = 'completed'
        Write-MpwScriptResult -OutputPath $OutputPath -Action $action -Ok $true -Stage $currentStage -SiteName $targetSiteName -Data $data -Warnings @($warnings)
        return 0
    }
    catch {
        $failure = $_
        $rollbackWarnings = [Collections.Generic.List[object]]::new()
        if ($null -ne $manager -and $null -ne $site -and $null -ne $siteSnapshot) {
            try {
                if ((Get-MpwFtpSiteRuntimeState -Site $site) -eq 'Started') { Stop-MpwSite -Site $site }
                Restore-MpwSiteSnapshot -Manager $manager -Site $site -Snapshot $siteSnapshot
                if ($null -ne $passiveSnapshot) {
                    Set-MpwGlobalPassivePorts -Manager $manager -Start ([int]$passiveSnapshot.start) -End ([int]$passiveSnapshot.end)
                }
                $manager.CommitChanges()
                if ($siteWasStarted) {
                    Start-MpwFtpService
                    Start-MpwSite -Site $site
                }
                elseif ((Get-MpwFtpSiteRuntimeState -Site $site) -ne 'Stopped') {
                    Stop-MpwSite -Site $site
                }
            }
            catch {
                [void]$rollbackWarnings.Add([ordered]@{ code = 'IIS_ROLLBACK_FAILED'; message = 'The adopted IIS site could not be fully restored to its previous configuration and state.'; technicalMessage = [string]$_.Exception.Message; exceptionType = [string]$_.Exception.GetType().FullName })
            }
        }
        foreach ($firewallResult in @($controlFirewallResult, $passiveFirewallResult)) {
            if ($null -eq $firewallResult) { continue }
            try { Restore-MpwFirewallRuleChange -Result $firewallResult } catch {
                [void]$rollbackWarnings.Add([ordered]@{ code = 'FIREWALL_ROLLBACK_FAILED'; message = 'A Windows Firewall FTP rule could not be fully restored.'; technicalMessage = [string]$_.Exception.Message; exceptionType = [string]$_.Exception.GetType().FullName })
            }
        }
        if ($null -ne $aclSnapshot -and -not [string]::IsNullOrWhiteSpace($physicalPath) -and [IO.Directory]::Exists($physicalPath)) {
            try { [IO.Directory]::SetAccessControl($physicalPath, $aclSnapshot) } catch {
                [void]$rollbackWarnings.Add([ordered]@{ code = 'FTP_ACL_ROLLBACK_FAILED'; message = 'The target FTP directory ACL could not be restored.' })
            }
        }
        if ($null -ne $accountResult -and [bool]$accountResult.created) {
            try { Remove-MpwManagedLocalAccount -Username ([string]$accountResult.username) } catch {
                [void]$rollbackWarnings.Add([ordered]@{ code = 'FTP_ACCOUNT_ROLLBACK_FAILED'; message = 'The newly created managed FTP account could not be removed.' })
            }
        }
        elseif ($null -ne $accountResult -and [bool]$accountResult.passwordReset) {
            [void]$rollbackWarnings.Add([ordered]@{ code = 'FTP_PASSWORD_ROLLBACK_UNAVAILABLE'; message = 'Windows does not expose the previous password; the password change itself cannot be reversed.' })
        }
        $password = $null
        $safe = ConvertTo-MpwSafeException -ErrorRecord $failure
        $data = [ordered]@{
            action = $action
            status = 'failed'
            message = 'IIS FTP site adoption failed; the previous site configuration and state were restored when possible.'
            steps = @($steps)
            warnings = @($rollbackWarnings | ForEach-Object { [string]$_.message })
            requiresAdmin = $safe.code -eq 'ADMIN_REQUIRED'
        }
        $rollbackAttempted = [bool]($null -ne $siteSnapshot -or $null -ne $aclSnapshot -or $null -ne $accountResult -or $null -ne $controlFirewallResult -or $null -ne $passiveFirewallResult)
        $rollbackSucceeded = if ($rollbackAttempted) { $rollbackWarnings.Count -eq 0 } else { $null }
        Write-MpwScriptResult -OutputPath $OutputPath -Action $action -Ok $false -Stage $currentStage -SiteName $targetSiteName -Data $data -ErrorObject $safe -Warnings @($rollbackWarnings) -RollbackAttempted $rollbackAttempted -RollbackSucceeded $rollbackSucceeded
        return (Get-MpwExitCode -Code ([string]$safe.code))
    }
    finally {
        $password = $null
        if ($null -ne $manager) { $manager.Dispose() }
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    exit (Invoke-MpwIisFtpAdopt -InputPath $InputPath -OutputPath $OutputPath)
}
