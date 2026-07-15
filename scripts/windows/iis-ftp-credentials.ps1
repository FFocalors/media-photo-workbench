param(
    [string]$InputPath,
    [string]$OutputPath
)

$commonPath = Join-Path $PSScriptRoot 'iis-ftp-common.ps1'
. $commonPath

function Set-MpwSiteAuthorizationUser {
    param(
        [Parameter(Mandatory = $true)]$Manager,
        [Parameter(Mandatory = $true)]$Site,
        [Parameter(Mandatory = $true)][string]$Username,
        [AllowNull()][string]$PreviousUsername = $null
    )

    $authorization = Get-MpwFtpAuthorizationSection -Manager $Manager -SiteName ([string]$Site.Name)
    $authorizationCollection = $authorization.GetCollection()
    foreach ($existingRule in @($authorizationCollection | Where-Object {
        [string]$_['users'] -eq $Username -or (-not [string]::IsNullOrWhiteSpace($PreviousUsername) -and [string]$_['users'] -eq $PreviousUsername)
    })) {
        [void]$authorizationCollection.Remove($existingRule)
    }
    $rule = $authorizationCollection.CreateElement('add')
    $rule['accessType'] = 'Allow'
    $rule['users'] = $Username
    $rule['roles'] = ''
    $rule['permissions'] = 'Read, Write'
    [void]$authorizationCollection.Add($rule)
}

function Test-MpwIisAccountPreconfigurationAllowed {
    param([AllowNull()][string]$ErrorCode)

    return [string]::Equals($ErrorCode, 'IIS_FTP_NOT_INSTALLED', [StringComparison]::Ordinal)
}

function Invoke-MpwIisFtpCredentials {
    param(
        [Parameter(Mandatory = $true)][string]$InputPath,
        [Parameter(Mandatory = $true)][string]$OutputPath
    )

    $action = 'set'
    $password = $null
    $manager = $null
    $site = $null
    $siteSnapshot = $null
    $aclSnapshot = $null
    $accountResult = $null
    $options = $null
    $physicalPath = $null
    $commitAttempted = $false
    $iisPreconfigurationOnly = $false
    $previousAccountDisabled = $false
    $currentStage = 'read_input'
    $steps = [Collections.Generic.List[object]]::new()
    $warnings = [Collections.Generic.List[object]]::new()

    try {
        $currentStage = 'read_input'
        $inputObject = Read-MpwJsonInput -Path $InputPath -DeleteAfterRead
        $currentStage = 'validate_input'
        Assert-MpwAllowedInputProperties -InputObject $inputObject -AllowedProperties @((Get-MpwCommonInputProperties) + @('password', 'previousUsername'))
        $action = Assert-MpwAction -InputObject $inputObject -AllowedActions @('set')
        $currentStage = 'check_permissions'
        Assert-MpwAdministrator
        $currentStage = 'validate_configuration'
        $options = Get-MpwNormalizedOptions -InputObject $inputObject
        $password = Assert-MpwPassword -Password (Get-MpwInputValue -InputObject $inputObject -Name 'password')
        $previousUsername = Assert-MpwUsername -Username ([string](Get-MpwInputValue -InputObject $inputObject -Name 'previousUsername' -DefaultValue $options.Username))

        $currentStage = 'preflight_account'
        $targetAccount = Get-MpwLocalAccountStatus -Username $options.Username
        if ($targetAccount.exists -eq $true -and $targetAccount.isManaged -ne $true) {
            Throw-MpwFailure -Code 'FTP_ACCOUNT_CONFLICT' -Message 'The requested local username is already owned by a non-managed Windows account.'
        }

        $currentStage = 'inspect_iis_site'
        try {
            $manager = Open-MpwServerManager
        }
        catch {
            $openError = ConvertTo-MpwSafeException -ErrorRecord $_
            if (-not (Test-MpwIisAccountPreconfigurationAllowed -ErrorCode $openError.code)) { throw }
            $iisPreconfigurationOnly = $true
            [void]$warnings.Add([ordered]@{ code = 'IIS_FTP_NOT_INSTALLED'; message = 'IIS FTP is not installed yet; only the managed account and active-event directory ACL will be prepared.' })
        }

        if ($iisPreconfigurationOnly -or $null -eq $manager.Sites[$options.SiteName]) {
            if ([string]::IsNullOrWhiteSpace($options.PhysicalPath)) {
                Throw-MpwFailure -Code 'FTP_PATH_INVALID' -Message 'The active event FTP path is required when the managed IIS FTP site does not exist yet.'
            }
            $physicalPath = Assert-MpwPhysicalPath -PhysicalPath $options.PhysicalPath -Create
            $options.PhysicalPath = $physicalPath
            if (-not $iisPreconfigurationOnly) {
                [void]$warnings.Add([ordered]@{ code = 'IIS_SITE_NOT_FOUND'; message = 'The managed account and active-event ACL will be prepared before IIS FTP setup or explicit site adoption.' })
            }
        }
        else {
            $site = $manager.Sites[$options.SiteName]
            $siteSnapshot = Get-MpwSiteSnapshot -Manager $manager -Site $site
            if (-not (Test-MpwSiteManagedByAccount -Site $site -SiteName $options.SiteName -Username $previousUsername -ManagedSiteId $options.ManagedSiteId)) {
                Throw-MpwFailure -Code 'IIS_SITE_ADOPTION_REQUIRED' -Message 'The configured IIS FTP site identity, previous managed account marker, or authorization does not match and cannot be modified before explicit adoption.'
            }
            $physicalPath = Assert-MpwPhysicalPath -PhysicalPath ([string]$siteSnapshot.physicalPath)
            $options.PhysicalPath = $physicalPath
        }
        $aclSnapshot = [IO.Directory]::GetAccessControl($physicalPath)
        [void]$steps.Add([ordered]@{ name = 'preflight'; status = 'success'; message = if ($iisPreconfigurationOnly) { 'IIS FTP is not installed; the account-only preconfiguration path was validated.' } else { 'The target account, IIS site ownership, and active-event FTP directory were validated.' } })

        $currentStage = 'configure_local_account'
        $accountResult = Ensure-MpwManagedLocalAccount -Username $options.Username -Password $password -RequirePassword
        $password = $null
        $currentStage = 'configure_directory_acl'
        [void](Grant-MpwDirectoryAccess -PhysicalPath $physicalPath -Username $options.Username)
        [void]$steps.Add([ordered]@{ name = 'account'; status = 'success'; message = 'The managed FTP account and password were updated.' })

        if ($null -ne $site) {
            $currentStage = 'configure_ftp_authorization'
            Set-MpwSiteAuthorizationUser -Manager $manager -Site $site -Username $options.Username -PreviousUsername $previousUsername
            $commitAttempted = $true
            $manager.CommitChanges()
            [void]$steps.Add([ordered]@{ name = 'authorization'; status = 'success'; message = 'IIS FTP authorization now targets the managed account with read/write access.' })
        }

        $currentStage = 'verify_configuration'
        $authorizationOk = $true
        if ($null -ne $site) {
            $siteAfter = Get-MpwFtpSiteModel -Manager $manager -Site $site
            $authorizationOk = @($siteAfter.authorization | Where-Object { $_.accessType -eq 'Allow' -and $_.users -eq $options.Username -and $_.permissions -match 'Read' -and $_.permissions -match 'Write' }).Count -gt 0
        }
        $aclAfter = Get-MpwDirectoryAclStatus -PhysicalPath $physicalPath -Username $options.Username
        $accountAfter = Get-MpwLocalAccountStatus -Username $options.Username
        if (-not $authorizationOk -or -not $aclAfter.readWriteAllowed -or $accountAfter.isManaged -ne $true -or $accountAfter.enabled -ne $true) {
            Throw-MpwFailure -Code 'FTP_CREDENTIAL_UPDATE_FAILED' -Message 'The updated FTP credentials did not pass account, authorization, and ACL verification.'
        }
        [void]$steps.Add([ordered]@{ name = 'verify'; status = 'success'; message = if ($iisPreconfigurationOnly) { 'The managed account and active-event directory ACL passed verification without changing IIS.' } else { 'The new account, IIS authorization, and directory ACL passed verification.' } })

        if ($null -eq $site -and $previousUsername -ne $options.Username) {
            [void]$warnings.Add([ordered]@{ code = 'PREVIOUS_FTP_ACCOUNT_PRESERVED'; message = 'The previous managed FTP account was left unchanged until IIS FTP setup is complete.' })
        }
        elseif ($previousUsername -ne $options.Username) {
            try {
                $previousAccountDisabled = Disable-MpwManagedLocalAccount -Username $previousUsername
                if ($previousAccountDisabled) {
                    Remove-MpwExplicitDirectoryAccess -PhysicalPath $physicalPath -Username $previousUsername
                }
            }
            catch {
                [void]$warnings.Add([ordered]@{ code = 'PREVIOUS_FTP_ACCOUNT_CLEANUP_FAILED'; message = 'The new credentials are active, but the previous managed account could not be fully disabled or removed from the ACL.' })
            }
        }

        $data = [ordered]@{
            action = $action
            status = 'success'
            message = if ($iisPreconfigurationOnly) { 'The FTP account and directory ACL were prepared; IIS FTP setup is still required.' } else { 'FTP account settings were updated.' }
            steps = @($steps)
            warnings = @($warnings | ForEach-Object { [string]$_.message })
            requiresAdmin = $false
            username = $options.Username
            siteId = if ($null -ne $site) { [long]$site.Id } else { $null }
            managedSiteId = [long]$options.ManagedSiteId
            passwordReset = $true
            authorizationUpdated = $null -ne $site
            previousAccountDisabled = $previousAccountDisabled
        }
        if (-not $iisPreconfigurationOnly) {
            $data['systemStatus'] = Get-MpwElevatedSystemStatus -Options $options
        }
        $currentStage = 'completed'
        Write-MpwScriptResult -OutputPath $OutputPath -Action $action -Ok $true -Stage $currentStage -SiteName $options.SiteName -Data $data -Warnings @($warnings)
        return 0
    }
    catch {
        $failure = $_
        $rollbackWarnings = [Collections.Generic.List[object]]::new()
        if ($commitAttempted -and $null -ne $manager -and $null -ne $site -and $null -ne $siteSnapshot) {
            try {
                Restore-MpwSiteSnapshot -Manager $manager -Site $site -Snapshot $siteSnapshot
                $manager.CommitChanges()
            }
            catch {
                [void]$rollbackWarnings.Add([ordered]@{ code = 'IIS_ROLLBACK_FAILED'; message = 'The prior IIS FTP authorization could not be fully restored.' })
            }
        }
        if ($null -ne $aclSnapshot -and -not [string]::IsNullOrWhiteSpace($physicalPath) -and [IO.Directory]::Exists($physicalPath)) {
            try { [IO.Directory]::SetAccessControl($physicalPath, $aclSnapshot) } catch {
                [void]$rollbackWarnings.Add([ordered]@{ code = 'FTP_ACL_ROLLBACK_FAILED'; message = 'The prior FTP directory ACL could not be restored.' })
            }
        }
        if ($previousAccountDisabled) {
            try {
                if (-not (Enable-MpwManagedLocalAccount -Username $previousUsername)) {
                    Throw-MpwFailure -Code 'FTP_ACCOUNT_ROLLBACK_FAILED' -Message 'The previous managed FTP account could not be found for rollback.'
                }
            }
            catch {
                [void]$rollbackWarnings.Add([ordered]@{ code = 'FTP_ACCOUNT_ROLLBACK_FAILED'; message = 'The previous managed FTP account could not be re-enabled during rollback.' })
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
            message = 'The FTP credential update failed; authorization and ACL rollback were attempted.'
            steps = @($steps)
            warnings = @($rollbackWarnings | ForEach-Object { [string]$_.message })
            requiresAdmin = $safe.code -eq 'ADMIN_REQUIRED'
            passwordReset = $null
        }
        $rollbackAttempted = [bool]($commitAttempted -or $null -ne $aclSnapshot -or $null -ne $accountResult -or $previousAccountDisabled)
        $rollbackSucceeded = if ($rollbackAttempted) { $rollbackWarnings.Count -eq 0 } else { $null }
        Write-MpwScriptResult -OutputPath $OutputPath -Action $action -Ok $false -Stage $currentStage -SiteName $(if ($null -ne $options) { $options.SiteName } else { '' }) -Data $data -ErrorObject $safe -Warnings @($rollbackWarnings) -RollbackAttempted $rollbackAttempted -RollbackSucceeded $rollbackSucceeded
        return (Get-MpwExitCode -Code ([string]$safe.code))
    }
    finally {
        $password = $null
        if ($null -ne $manager) { $manager.Dispose() }
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    exit (Invoke-MpwIisFtpCredentials -InputPath $InputPath -OutputPath $OutputPath)
}
