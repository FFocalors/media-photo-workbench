param(
    [string]$InputPath,
    [string]$OutputPath
)

$commonPath = Join-Path $PSScriptRoot 'iis-ftp-common.ps1'
. $commonPath

function Invoke-MpwIisFtpStatus {
    param(
        [Parameter(Mandatory = $true)][string]$InputPath,
        [Parameter(Mandatory = $true)][string]$OutputPath
    )

    $action = 'status'
    $currentStage = 'read_input'
    $options = $null
    try {
        $currentStage = 'read_input'
        $inputObject = Read-MpwJsonInput -Path $InputPath -DeleteAfterRead
        $currentStage = 'validate_input'
        Assert-MpwAllowedInputProperties -InputObject $inputObject -AllowedProperties @((Get-MpwCommonInputProperties) + @('passwordConfigured'))
        $action = Assert-MpwAction -InputObject $inputObject -AllowedActions @('status')
        $options = Get-MpwNormalizedOptions -InputObject $inputObject
        $warnings = [Collections.Generic.List[object]]::new()

        $os = $null
        try { $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop } catch {}
        $isWindows = $env:OS -eq 'Windows_NT'
        $buildNumber = if ($null -ne $os) { [int]$os.BuildNumber } else { [Environment]::OSVersion.Version.Build }
        $isWindows11 = $isWindows -and $buildNumber -ge 22000
        $isAdmin = Test-MpwAdministrator

        $currentStage = 'inspect_windows_environment'
        $features = @(Get-MpwWindowsFeaturesStatus)
        $service = Get-MpwFtpServiceStatus
        $port = Get-MpwPortStatus -Port $options.ControlPort -PassiveStart $options.PassivePortStart -PassiveEnd $options.PassivePortEnd
        $account = Get-MpwLocalAccountStatus -Username $options.Username
        $network = Get-MpwNetworkAddressStatus
        $controlFirewall = Get-MpwFirewallRuleModel -InternalName $script:MpwControlFirewallInternalName -DisplayName $options.FirewallControlRuleName -LegacyDisplayNames @('MPW IIS FTP Control')
        $passiveFirewall = Get-MpwFirewallRuleModel -InternalName $script:MpwPassiveFirewallInternalName -DisplayName $options.FirewallPassiveRuleName -LegacyDisplayNames @('MPW IIS FTP Passive')
        $legacyControlFirewall = Get-MpwFirewallRuleModel -InternalName '__mpw_no_rule__' -DisplayName 'MPW IIS FTP Control'
        $legacyPassiveFirewall = Get-MpwFirewallRuleModel -InternalName '__mpw_no_rule__' -DisplayName 'MPW IIS FTP Passive'

        $iisDetection = 'unknown'
        $sites = @()
        $selectedSite = $null
        $namedSiteIdentity = $null
        $adoptionCandidates = @()
        $passivePorts = [ordered]@{ detection = 'unknown'; start = $null; end = $null; matchesExpected = $null }
        $iisErrorCode = $null
        $manager = $null
        $currentStage = 'inspect_iis_sites'
        try {
            $manager = Open-MpwServerManager
            $targetSite = if ($options.ManagedSiteId -gt 0) { Get-MpwIisSiteById -Manager $manager -SiteId $options.ManagedSiteId } else { $null }
            if ($null -eq $targetSite) { $targetSite = $manager.Sites[$options.SiteName] }
            if ($null -ne $targetSite) {
                $namedSiteIdentity = Get-MpwIisSiteIdentityModel -Site $targetSite
            }
            $sites = @(Get-MpwFtpSites -Manager $manager)
            $selectedSite = if ($null -ne $namedSiteIdentity) { $sites | Where-Object { [long]$_.id -eq [long]$namedSiteIdentity.id } | Select-Object -First 1 } else { $null }
            $resolvedSiteName = if ($null -ne $namedSiteIdentity) { [string]$namedSiteIdentity.name } else { $options.SiteName }
            $adoptionCandidates = @(Find-MpwPortSites -Manager $manager -Port $options.ControlPort -ExcludeSiteName $resolvedSiteName)
            $ports = Get-MpwGlobalPassivePorts -Manager $manager
            $passivePorts = [ordered]@{
                detection = 'available'
                start = [int]$ports.start
                end = [int]$ports.end
                matchesExpected = [int]$ports.start -eq $options.PassivePortStart -and [int]$ports.end -eq $options.PassivePortEnd
            }
            $iisDetection = 'available'
        }
        catch {
            if ($isAdmin) {
                # An elevated read must never be reported as a successful
                # administrator inspection when IIS details are still unknown.
                # Re-throw so the caller receives the exact structured stage
                # and technical error instead of an empty candidate list.
                throw
            }
            $safe = ConvertTo-MpwSafeException -ErrorRecord $_
            $iisErrorCode = $safe.code
            if ($iisErrorCode -eq 'IIS_STATUS_CHECK_FAILED' -and -not $isAdmin) {
                $iisErrorCode = 'ADMIN_REQUIRED'
            }
            [void]$warnings.Add([ordered]@{ code = $iisErrorCode; message = 'IIS site configuration could not be read without elevated access.' })
        }
        finally {
            if ($null -ne $manager) { $manager.Dispose() }
        }

        $siteData = $null
        if ($iisDetection -eq 'available') {
            if ($null -eq $selectedSite) {
                if ($null -ne $namedSiteIdentity) {
                    $siteData = [ordered]@{
                        detection = 'available'
                        exists = $true
                        id = [long]$namedSiteIdentity.id
                        name = [string]$namedSiteIdentity.name
                        state = [string]$namedSiteIdentity.state
                        physicalPath = [string]$namedSiteIdentity.physicalPath
                        bindings = @($namedSiteIdentity.bindings)
                        authentication = $null
                        authorization = @()
                        ssl = $null
                        externalIp4Address = $null
                        isFtpSite = $false
                        matchesExpected = $false
                    }
                }
                else {
                    $siteData = [ordered]@{
                        detection = 'available'
                        exists = $false
                        id = $null
                        name = $options.SiteName
                        state = $null
                        physicalPath = $null
                        bindings = @()
                        authentication = $null
                        authorization = @()
                        ssl = $null
                        externalIp4Address = $null
                        isFtpSite = $false
                        matchesExpected = $false
                    }
                }
            }
            else {
                $expectedAuthorization = @($selectedSite.authorization | Where-Object {
                    $_.accessType -eq 'Allow' -and $_.users -eq $options.Username -and $_.permissions -match 'Read' -and $_.permissions -match 'Write'
                }).Count -gt 0
                $expectedBinding = @($selectedSite.bindings | Where-Object { $_.protocol -eq 'ftp' -and $_.bindingInformation -eq $options.Binding }).Count -eq 1
                $expectedPath = $true
                if (-not [string]::IsNullOrWhiteSpace($options.PhysicalPath)) {
                    try {
                        $expectedPath = [IO.Path]::GetFullPath([string]$selectedSite.physicalPath).TrimEnd('\') -eq [IO.Path]::GetFullPath($options.PhysicalPath).TrimEnd('\')
                    }
                    catch { $expectedPath = $false }
                }
                $selectedSite['detection'] = 'available'
                $selectedSite['exists'] = $true
                $selectedSite['isFtpSite'] = $true
                $siteIdMatches = [bool]($options.ManagedSiteId -gt 0 -and [long]$selectedSite.id -eq $options.ManagedSiteId)
                $selectedSite['matchesExpected'] = [bool](
                    $siteIdMatches -and
                    $expectedBinding -and
                    $expectedPath -and
                    $selectedSite.authentication.basicEnabled -and
                    -not $selectedSite.authentication.anonymousEnabled -and
                    $selectedSite.ssl.controlChannelPolicy -eq 'SslAllow' -and
                    $selectedSite.ssl.dataChannelPolicy -eq 'SslAllow' -and
                    $expectedAuthorization
                )
                $siteData = $selectedSite
            }
        }
        else {
            $siteData = [ordered]@{
                detection = 'unknown'
                exists = $null
                id = $null
                name = $options.SiteName
                state = 'unknown'
                physicalPath = $null
                bindings = @()
                authentication = $null
                authorization = @()
                ssl = $null
                externalIp4Address = $null
                isFtpSite = $null
                matchesExpected = $null
                errorCode = $iisErrorCode
            }
        }

        $aclPath = $options.PhysicalPath
        if ($siteData.exists -eq $true -and -not [string]::IsNullOrWhiteSpace([string]$siteData.physicalPath)) {
            $aclPath = [string]$siteData.physicalPath
        }
        $acl = Get-MpwDirectoryAclStatus -PhysicalPath $aclPath -Username $options.Username

        $featureUnknown = @($features | Where-Object { $_.state -eq 'unknown' }).Count -gt 0
        $requiresAdmin = [bool]($featureUnknown -or $iisDetection -eq 'unknown')
        $portConflict = [bool]($port.usedByOtherProcess -or $port.reserved)
        $accountConflict = [bool]($account.exists -eq $true -and $account.conflict -eq $true)

        if ($controlFirewall.exists -eq $true -and ([string]$controlFirewall.remoteAddress -ne 'LocalSubnet' -or [string]$controlFirewall.localPort -ne [string]$options.ControlPort)) {
            [void]$warnings.Add([ordered]@{ code = 'FIREWALL_CONFIG_MISMATCH'; message = 'The FTP control firewall rule does not match the configured control port and LocalSubnet.' })
        }
        $expectedPassiveRange = "$($options.PassivePortStart)-$($options.PassivePortEnd)"
        if ($passiveFirewall.exists -eq $true -and ([string]$passiveFirewall.remoteAddress -ne 'LocalSubnet' -or [string]$passiveFirewall.localPort -ne $expectedPassiveRange)) {
            [void]$warnings.Add([ordered]@{ code = 'FIREWALL_CONFIG_MISMATCH'; message = 'The FTP passive firewall rule does not match the configured passive ports and LocalSubnet.' })
        }
        if ($accountConflict) {
            [void]$warnings.Add([ordered]@{ code = 'FTP_ACCOUNT_CONFLICT'; message = 'The configured username belongs to an account that is not marked as Media Photo Workbench managed.' })
        }
        if ($acl.broadInheritedAccess -eq $true) {
            [void]$warnings.Add([ordered]@{ code = 'FTP_ACL_BROAD_ACCESS'; message = 'The FTP root inherits write-capable access for broad Windows principals.' })
        }

        $missingItems = [Collections.Generic.List[string]]::new()
        foreach ($feature in $features | Where-Object { $_.state -ne 'Enabled' -and $_.state -ne 'unknown' }) { [void]$missingItems.Add([string]$feature.featureName) }
        if ($service.exists -eq $false) { [void]$missingItems.Add('FTPSVC') }
        if ($iisDetection -eq 'available' -and $siteData.isFtpSite -ne $true) { [void]$missingItems.Add('IIS_FTP_SITE') }
        if ($controlFirewall.exists -eq $false) { [void]$missingItems.Add('FIREWALL_CONTROL_RULE') }
        if ($passiveFirewall.exists -eq $false) { [void]$missingItems.Add('FIREWALL_PASSIVE_RULE') }
        if ($account.exists -eq $false) { [void]$missingItems.Add('FTP_ACCOUNT') }
        if ($acl.exists -eq $false) { [void]$missingItems.Add('FTP_PATH') }

        $passwordConfigured = [bool](Get-MpwInputValue -InputObject $inputObject -Name 'passwordConfigured' -DefaultValue $false)
        $ftpServiceFeatureRaw = $features | Where-Object { $_.featureName -eq 'IIS-FTPSvc' } | Select-Object -First 1
        $ftpExtensibilityFeatureRaw = $features | Where-Object { $_.featureName -eq 'IIS-FTPExtensibility' } | Select-Object -First 1
        $managementFeatureRaw = $features | Where-Object { $_.featureName -eq 'IIS-ManagementScriptingTools' } | Select-Object -First 1
        $ftpServiceFeature = [ordered]@{
            featureName = 'IIS-FTPSvc'
            installed = if ($null -eq $ftpServiceFeatureRaw -or $ftpServiceFeatureRaw.state -eq 'unknown') { $null } else { $ftpServiceFeatureRaw.state -eq 'Enabled' }
            state = if ($null -eq $ftpServiceFeatureRaw) { 'unknown' } else { [string]$ftpServiceFeatureRaw.state }
            error = if ($null -ne $ftpServiceFeatureRaw) { [string](Get-MpwInputValue -InputObject $ftpServiceFeatureRaw -Name 'errorCode' -DefaultValue '') } else { '' }
        }
        $ftpExtensibilityFeature = [ordered]@{
            featureName = 'IIS-FTPExtensibility'
            installed = if ($null -eq $ftpExtensibilityFeatureRaw -or $ftpExtensibilityFeatureRaw.state -eq 'unknown') { $null } else { $ftpExtensibilityFeatureRaw.state -eq 'Enabled' }
            state = if ($null -eq $ftpExtensibilityFeatureRaw) { 'unknown' } else { [string]$ftpExtensibilityFeatureRaw.state }
            error = if ($null -ne $ftpExtensibilityFeatureRaw) { [string](Get-MpwInputValue -InputObject $ftpExtensibilityFeatureRaw -Name 'errorCode' -DefaultValue '') } else { '' }
        }
        $managementFeature = [ordered]@{
            featureName = 'IIS-ManagementScriptingTools'
            installed = if ($null -eq $managementFeatureRaw -or $managementFeatureRaw.state -eq 'unknown') { $null } else { $managementFeatureRaw.state -eq 'Enabled' }
            state = if ($null -eq $managementFeatureRaw) { 'unknown' } else { [string]$managementFeatureRaw.state }
            error = if ($null -ne $managementFeatureRaw) { [string](Get-MpwInputValue -InputObject $managementFeatureRaw -Name 'errorCode' -DefaultValue '') } else { '' }
        }

        $bindingValue = ''
        if ($siteData.exists -eq $true) {
            $firstFtpBinding = $siteData.bindings | Where-Object { $_.protocol -eq 'ftp' } | Select-Object -First 1
            if ($null -ne $firstFtpBinding) { $bindingValue = [string]$firstFtpBinding.bindingInformation }
        }
        $bindingHost = ''
        if ($bindingValue -match '^(.+):(\d+):(.*)$') { $bindingHost = [string]$Matches[1] }
        $allUnassigned = if ($siteData.exists -eq $true) { $bindingValue -eq $options.Binding } elseif ($siteData.exists -eq $false) { $false } else { $null }
        $bindingCorrect = if ($siteData.exists -eq $true) { $bindingValue -eq $options.Binding } elseif ($siteData.exists -eq $false) { $false } else { $null }

        $siteIsFtp = [bool]($siteData.exists -eq $true -and $siteData.isFtpSite -eq $true)
        $basicEnabled = if ($siteIsFtp) { [bool]$siteData.authentication.basicEnabled } elseif ($siteData.exists -eq $true) { $false } else { $null }
        $anonymousEnabled = if ($siteIsFtp) { [bool]$siteData.authentication.anonymousEnabled } elseif ($siteData.exists -eq $true) { $false } else { $null }
        $authCorrect = if ($siteData.exists -eq $true) { [bool]($basicEnabled -and -not $anonymousEnabled) } else { $null }
        $authorizationRule = if ($siteData.exists -eq $true) { $siteData.authorization | Where-Object { $_.accessType -eq 'Allow' -and $_.users -eq $options.Username } | Select-Object -First 1 } else { $null }
        $authorizationRead = if ($null -ne $authorizationRule) { [bool]([string]$authorizationRule.permissions -match 'Read') } elseif ($siteData.exists -eq $true) { $false } else { $null }
        $authorizationWrite = if ($null -ne $authorizationRule) { [bool]([string]$authorizationRule.permissions -match 'Write') } elseif ($siteData.exists -eq $true) { $false } else { $null }
        $authorizationCorrect = if ($siteData.exists -eq $true) { [bool]($authorizationRead -and $authorizationWrite) } else { $null }
        $sslEnabled = if ($siteIsFtp) { [bool]($siteData.ssl.controlChannelPolicy -ne 'SslAllow' -or $siteData.ssl.dataChannelPolicy -ne 'SslAllow') } elseif ($siteData.exists -eq $true) { $false } else { $null }
        $siteIdMatches = if ($siteData.exists -eq $true) { [bool]($options.ManagedSiteId -gt 0 -and [long]$siteData.id -eq $options.ManagedSiteId) } elseif ($siteData.exists -eq $false) { $false } else { $null }
        $sameNameIdConflict = if ($siteData.exists -eq $true) { [bool](-not $siteIdMatches) } elseif ($siteData.exists -eq $false) { $false } else { $null }
        $siteManaged = if ($siteData.exists -eq $true) { [bool]($siteIdMatches -and $siteIsFtp -and $account.managed -eq $true) } elseif ($siteData.exists -eq $false) { $false } else { $null }
        $siteOwned = $siteManaged
        $sameNameOwnershipConflict = if ($siteData.exists -eq $true) { [bool](-not $siteOwned) } elseif ($siteData.exists -eq $false) { $false } else { $null }
        $siteAdoptable = if ($siteData.exists -eq $true) { [bool]($sameNameOwnershipConflict -and $siteIsFtp) } elseif ($siteData.exists -eq $false) { $false } else { $null }
        $siteAdoptionRequired = if ($iisDetection -eq 'available') { [bool]($sameNameOwnershipConflict -or ($siteData.exists -eq $false -and $adoptionCandidates.Count -gt 0)) } else { $null }
        if ($sameNameOwnershipConflict -eq $true) {
            $ownershipWarning = if ($sameNameIdConflict) { 'The configured IIS site identity does not match managedSiteId and requires explicit adoption.' } elseif (-not $siteIsFtp) { 'The configured IIS site has no FTP binding and requires explicit adoption.' } else { 'The configured IIS site account marker is not managed and requires explicit adoption.' }
            [void]$warnings.Add([ordered]@{ code = 'IIS_SITE_ADOPTION_REQUIRED'; message = $ownershipWarning })
        }

        $controlFirewallCorrect = [bool]($controlFirewall.exists -eq $true -and $controlFirewall.enabled -eq $true -and [string]$controlFirewall.profile -eq 'Any' -and [string]$controlFirewall.remoteAddress -eq 'LocalSubnet' -and [string]$controlFirewall.localPort -eq [string]$options.ControlPort -and [string]$controlFirewall.protocol -eq 'TCP')
        $passiveFirewallCorrect = [bool]($passiveFirewall.exists -eq $true -and $passiveFirewall.enabled -eq $true -and [string]$passiveFirewall.profile -eq 'Any' -and [string]$passiveFirewall.remoteAddress -eq 'LocalSubnet' -and [string]$passiveFirewall.localPort -eq $expectedPassiveRange -and [string]$passiveFirewall.protocol -eq 'TCP')
        $conflictItems = [Collections.Generic.List[object]]::new()
        if ($sameNameOwnershipConflict -eq $true) {
            [void]$conflictItems.Add([ordered]@{
                type = 'site'
                code = 'IIS_SITE_ADOPTION_REQUIRED'
                message = if ($sameNameIdConflict) { 'An IIS site with the configured name has a different identity and requires explicit adoption.' } elseif (-not $siteIsFtp) { 'An IIS site with the configured name has no FTP binding and requires explicit adoption.' } else { 'The configured IIS site does not have the required managed account marker; explicit adoption is required.' }
                siteName = [string]$siteData.name
                physicalPath = [string]$siteData.physicalPath
                binding = $bindingValue
                port = $options.ControlPort
                status = [string]$siteData.state
                adoptable = [bool]$siteIsFtp
                expectedSiteId = [long]$options.ManagedSiteId
                actualSiteId = [long]$siteData.id
            })
        }
        foreach ($candidate in $adoptionCandidates) {
            $candidateBinding = $candidate.bindings | Where-Object { $_.protocol -eq 'ftp' -and $_.port -eq $options.ControlPort } | Select-Object -First 1
            $verifiedTestSite = [string]$candidate.name -eq 'MPW-IIS-FTP-Test'
            [void]$conflictItems.Add([ordered]@{
                type = 'site'
                code = 'IIS_SITE_PORT_CONFLICT'
                message = 'Another IIS FTP site uses the configured control port. Choose another port or explicitly adopt an eligible site.'
                siteName = [string]$candidate.name
                physicalPath = [string]$candidate.physicalPath
                binding = if ($null -ne $candidateBinding) { [string]$candidateBinding.bindingInformation } else { '' }
                port = $options.ControlPort
                status = [string]$candidate.state
                adoptable = $true
                verifiedWithNikon = $verifiedTestSite
                canChangePort = $true
                availablePorts = @($port.availablePorts)
                recommendation = 'Choose an available port. Do not modify unrelated IIS sites.'
            })
        }
        if ($port.reserved) {
            [void]$conflictItems.Add([ordered]@{ type = 'port'; code = 'FTP_CONTROL_PORT_RESERVED'; message = 'The configured control port is reserved by Windows.'; port = $options.ControlPort; source = 'windowsReservedPort'; adoptable = $false; canChangePort = $true; availablePorts = @($port.availablePorts); recommendation = 'Choose one of the available control ports.' })
        }
        if ($port.usedByOtherProcess) {
            [void]$conflictItems.Add([ordered]@{ type = 'port'; code = 'PORT_USED_BY_OTHER_PROCESS'; message = 'The configured control port is owned by another process.'; port = $options.ControlPort; pid = $port.pid; processName = [string]$port.processName; source = 'process'; adoptable = $false; canChangePort = $true; availablePorts = @($port.availablePorts); recommendation = 'Do not stop the other process automatically. Choose another available control port.' })
        }
        if ($accountConflict) {
            [void]$conflictItems.Add([ordered]@{ type = 'user'; code = 'FTP_ACCOUNT_CONFLICT'; message = 'The configured username is not a Media Photo Workbench managed account.'; adoptable = $false })
        }
        $pathConflict = if ($iisDetection -eq 'unknown') {
            $null
        }
        elseif ($siteData.exists -eq $true -and -not [string]::IsNullOrWhiteSpace($options.PhysicalPath)) {
            try {
                [bool]([IO.Path]::GetFullPath([string]$siteData.physicalPath).TrimEnd('\') -ne [IO.Path]::GetFullPath($options.PhysicalPath).TrimEnd('\'))
            }
            catch { $true }
        }
        else { $false }
        $warningMessages = @($warnings | ForEach-Object { [string]$_.message })
        $iisSiteNames = @()
        if ($bindingCorrect -eq $true) { $iisSiteNames += [string]$siteData.name }
        $iisSiteNames += @($adoptionCandidates | ForEach-Object { [string]$_.name })
        $port.iisSiteNames = @($iisSiteNames | Select-Object -Unique)
        $port.iisSiteName = if ($port.iisSiteNames.Count -gt 0) { [string]$port.iisSiteNames[0] } else { '' }
        $port.ownedByManagedSite = if ($iisDetection -eq 'available') { [bool]($siteManaged -and $bindingCorrect) } else { $null }
        $port.adoptable = if ($iisDetection -eq 'available') { [bool](@($conflictItems | Where-Object { $_.type -eq 'site' -and $_.adoptable -eq $true }).Count -eq 1) } else { $null }
        $port.conflict = if ($iisDetection -eq 'available') { [bool]($portConflict -or $sameNameOwnershipConflict -or $adoptionCandidates.Count -gt 0) } else { if ($portConflict) { $true } else { $null } }
        $portConflict = $port.conflict
        $data = [ordered]@{
            provider = 'iis'
            platform = [ordered]@{
                isWindows = $isWindows
                isWindows11 = $isWindows11
                supported = $isWindows11
                caption = if ($null -ne $os) { [string]$os.Caption } else { $null }
                version = if ($null -ne $os) { [string]$os.Version } else { [Environment]::OSVersion.Version.ToString() }
                buildNumber = $buildNumber
                architecture = if ($null -ne $os) { [string]$os.OSArchitecture } else { $env:PROCESSOR_ARCHITECTURE }
                powershellVersion = $PSVersionTable.PSVersion.ToString()
                elevated = $isAdmin
            }
            windowsFeatures = [ordered]@{
                ftpService = $ftpServiceFeature
                ftpExtensibility = $ftpExtensibilityFeature
                managementTools = $managementFeature
            }
            service = $service
            site = [ordered]@{
                id = if ($siteData.exists -eq $true) { [long]$siteData.id } else { $null }
                exists = $siteData.exists
                name = $options.SiteName
                status = [string]$siteData.state
                started = if ($siteData.exists -eq $true) { [string]$siteData.state -eq 'Started' } elseif ($siteData.exists -eq $false) { $false } else { $null }
                physicalPath = if ($siteData.exists -eq $true) { [string]$siteData.physicalPath } else { '' }
                binding = $bindingValue
                controlPort = $options.ControlPort
                sslEnabled = $sslEnabled
                adoptable = $siteAdoptable
                managed = $siteManaged
            }
            binding = [ordered]@{ value = $bindingValue; host = $bindingHost; port = $options.ControlPort; allUnassigned = $allUnassigned; correct = $bindingCorrect }
            authentication = [ordered]@{ basicEnabled = $basicEnabled; anonymousEnabled = $anonymousEnabled; correct = $authCorrect }
            authorization = [ordered]@{ configured = if ($siteData.exists -eq $true) { $null -ne $authorizationRule } else { $null }; username = $options.Username; read = $authorizationRead; write = $authorizationWrite; correct = $authorizationCorrect }
            account = $account
            acl = $acl
            port = $port
            passivePorts = [ordered]@{ start = $passivePorts.start; end = $passivePorts.end; configured = if ($passivePorts.detection -eq 'available') { [bool]($passivePorts.start -gt 0 -and $passivePorts.end -gt 0) } else { $null }; correct = $passivePorts.matchesExpected }
            firewall = [ordered]@{
                controlRule = [ordered]@{ name = $options.FirewallControlRuleName; exists = $controlFirewall.exists; enabled = $controlFirewall.enabled; profile = [string]$controlFirewall.profile; remoteAddress = [string]$controlFirewall.remoteAddress; correct = $controlFirewallCorrect }
                passiveRule = [ordered]@{ name = $options.FirewallPassiveRuleName; exists = $passiveFirewall.exists; enabled = $passiveFirewall.enabled; profile = [string]$passiveFirewall.profile; remoteAddress = [string]$passiveFirewall.remoteAddress; correct = $passiveFirewallCorrect }
                correct = [bool]($controlFirewallCorrect -and $passiveFirewallCorrect)
            }
            requiresAdmin = $requiresAdmin
            repairable = [bool]($isWindows11 -and -not $requiresAdmin -and -not $portConflict -and -not $accountConflict -and $sameNameOwnershipConflict -ne $true)
            missingItems = @($missingItems)
            conflicts = [ordered]@{
                portConflict = $portConflict
                siteConflict = $siteAdoptionRequired
                userConflict = $accountConflict
                pathConflict = $pathConflict
                items = @($conflictItems)
            }
            warnings = $warningMessages
            lastError = if ($null -ne $iisErrorCode) { [ordered]@{ code = $iisErrorCode; message = 'IIS configuration access is incomplete.' } } else { $null }
            networkAddresses = $network
            passwordConfigured = $passwordConfigured
            evidence = [ordered]@{
                rawFeatures = $features
                rawSite = $siteData
                sites = @($sites)
                adoptionCandidates = @($adoptionCandidates)
                rawFirewall = [ordered]@{ control = $controlFirewall; passive = $passiveFirewall; existingTestControl = $legacyControlFirewall; existingTestPassive = $legacyPassiveFirewall }
            }
        }

        $currentStage = 'completed'
        Write-MpwScriptResult -OutputPath $OutputPath -Action $action -Ok $true -Stage $currentStage -SiteName $options.SiteName -Data $data -Warnings @($warnings)
        return 0
    }
    catch {
        $safe = ConvertTo-MpwSafeException -ErrorRecord $_
        Write-MpwScriptResult -OutputPath $OutputPath -Action $action -Ok $false -Stage $currentStage -SiteName $(if ($null -ne $options) { $options.SiteName } else { '' }) -ErrorObject $safe
        return (Get-MpwExitCode -Code ([string]$safe.code))
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    exit (Invoke-MpwIisFtpStatus -InputPath $InputPath -OutputPath $OutputPath)
}
