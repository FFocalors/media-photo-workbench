Set-StrictMode -Version Latest

$script:MpwIisSchemaVersion = 2
$script:MpwManagedAccountDescription = 'Media Photo Workbench Managed FTP Account'
$script:MpwDefaultSiteName = 'MediaPhotoWorkbenchFTP'
$script:MpwDefaultUsername = 'camera'
$script:MpwControlPort = 21
$script:MpwPassivePortStart = 50000
$script:MpwPassivePortEnd = 50100
$script:MpwControlFirewallInternalName = 'MediaPhotoWorkbench-FTP-Control'
$script:MpwPassiveFirewallInternalName = 'MediaPhotoWorkbench-FTP-Passive'
$script:MpwServicePendingTimeoutMilliseconds = 60000
$script:MpwServiceStartTimeoutMilliseconds = 45000
$script:MpwFtpSiteStateTimeoutMilliseconds = 30000
$script:MpwFtpListenerTimeoutMilliseconds = 30000
$script:MpwEffectivePrincipalSidCache = @{}

function Get-MpwInputValue {
    param(
        [AllowNull()]$InputObject,
        [Parameter(Mandatory = $true)][string]$Name,
        [AllowNull()]$DefaultValue = $null
    )

    if ($null -eq $InputObject) {
        return $DefaultValue
    }

    if ($InputObject -is [Collections.IDictionary] -and $InputObject.Contains($Name)) {
        $dictionaryValue = $InputObject[$Name]
        if ($null -eq $dictionaryValue) { return $DefaultValue }
        return $dictionaryValue
    }

    $property = $InputObject.PSObject.Properties[$Name]
    if ($null -eq $property -or $null -eq $property.Value) {
        return $DefaultValue
    }

    return $property.Value
}

function Test-MpwInputProperty {
    param(
        [AllowNull()]$InputObject,
        [Parameter(Mandatory = $true)][string]$Name
    )

    return $null -ne $InputObject -and $null -ne $InputObject.PSObject.Properties[$Name]
}

function Throw-MpwFailure {
    param(
        [Parameter(Mandatory = $true)][string]$Code,
        [Parameter(Mandatory = $true)][string]$Message,
        [AllowNull()]$Details = $null,
        [AllowNull()][string]$Command = $null
    )

    $exception = [System.InvalidOperationException]::new($Message)
    $exception.Data['MpwCode'] = $Code
    if ($null -ne $Details) {
        $exception.Data['MpwDetails'] = $Details
    }
    if (-not [string]::IsNullOrWhiteSpace($Command)) {
        $exception.Data['MpwCommand'] = $Command
    }
    throw $exception
}

function ConvertTo-MpwSafeException {
    param([Parameter(Mandatory = $true)][System.Management.Automation.ErrorRecord]$ErrorRecord)

    $exception = $ErrorRecord.Exception
    $code = 'IIS_CONFIG_FAILED'
    if ($null -ne $exception.Data -and $exception.Data.Contains('MpwCode')) {
        $code = [string]$exception.Data['MpwCode']
    }
    elseif ($exception -is [System.UnauthorizedAccessException]) {
        $code = 'ADMIN_REQUIRED'
    }

    $details = $null
    if ($null -ne $exception.Data -and $exception.Data.Contains('MpwDetails')) {
        $details = $exception.Data['MpwDetails']
    }

    $technicalMessage = [string]$exception.Message
    try {
        if ($null -ne $details -and -not [string]::IsNullOrWhiteSpace([string]$details.technicalMessage)) {
            $technicalMessage = [string]$details.technicalMessage
        }
    }
    catch {}

    $command = ''
    if ($null -ne $exception.Data -and $exception.Data.Contains('MpwCommand')) {
        $command = [string]$exception.Data['MpwCommand']
    }
    else {
        try {
            if ($null -ne $ErrorRecord.InvocationInfo -and $null -ne $ErrorRecord.InvocationInfo.MyCommand) {
                $command = [string]$ErrorRecord.InvocationInfo.MyCommand.Name
            }
        }
        catch {}
    }

    return [ordered]@{
        code = $code
        message = [string]$exception.Message
        technicalMessage = $technicalMessage
        exceptionType = [string]$exception.GetType().FullName
        command = $command
        details = $details
    }
}

function Get-MpwExceptionDiagnosticDetails {
    param([Parameter(Mandatory = $true)][System.Management.Automation.ErrorRecord]$ErrorRecord)

    $messages = [Collections.Generic.List[string]]::new()
    $sourceException = $ErrorRecord.Exception
    $current = $ErrorRecord.Exception
    $depth = 0
    while ($null -ne $current -and $depth -lt 12) {
        if (-not [string]::IsNullOrWhiteSpace([string]$current.Message) -and -not $messages.Contains([string]$current.Message)) {
            [void]$messages.Add([string]$current.Message)
        }
        $sourceException = $current
        $current = $current.InnerException
        $depth++
    }
    return [ordered]@{
        technicalMessage = [string]::Join(' --> ', @($messages))
        innerTechnicalMessage = if ($messages.Count -gt 1) { [string]$messages[$messages.Count - 1] } else { '' }
        sourceExceptionType = [string]$sourceException.GetType().FullName
        hresult = ('0x{0:X8}' -f ([long]$sourceException.HResult -band 0xFFFFFFFFL))
    }
}

function Get-MpwExitCode {
    param([AllowNull()][string]$Code)

    if ([string]::IsNullOrWhiteSpace($Code)) { return 1 }
    switch -Regex ($Code) {
        '^(INVALID_|INPUT_|FTP_PASSWORD_REQUIRED|FTP_PASSWORD_INVALID|FTP_PATH_INVALID|FTP_PATH_CREATE_FAILED|FTP_CONTROL_PORT_INVALID|FTP_PORT_RANGE_CONFLICT|TEMP_FILE_)' { return 2 }
        '^(ADMIN_REQUIRED|ACCESS_DENIED|UAC_CANCELLED)' { return 3 }
        '^(IIS_FTP_NOT_INSTALLED|IIS_FTP_INSTALL_FAILED|IIS_FTP_FEATURE_|IIS_FEATURE_|IIS_CONFIGURATION_|IIS_MANAGEMENT_API_|IIS_COMPONENT_INSTALL_|IIS_SYSTEM_CONFIGURATION_|WINDOWS_FEATURE_|WINDOWS_RESTART_REQUIRED)' { return 4 }
        '^(IIS_SITE_|SITE_|MANAGED_SITE_ID_|PHYSICAL_PATH_|FTP_CONTROL_PORT_IN_USE|FTP_CONTROL_PORT_RESERVED|PORT_USED_BY_OTHER_PROCESS|NO_AVAILABLE_FTP_PORT|FTP_BINDING_)' { return 5 }
        '^(FTP_ACCOUNT_|FTP_CREDENTIAL_)' { return 6 }
        '^(FTP_ACL_|FTP_DIRECTORY_ACL_|ACL_)' { return 7 }
        '^(FIREWALL_)' { return 8 }
        '^(IIS_SERVICE_|IIS_DEPENDENCY_SERVICE_|IIS_SHARED_FTP_SERVICE_|IIS_FTP_SERVICE_|IIS_FTP_SITE_(START|STOP)|IIS_FTP_LISTENER_|FTP_SERVICE_|CONTROL_PORT_NOT_LISTENING|CONTROL_PORT_LISTENER_|FTPSVC_)' { return 9 }
        '^(IIS_ROLLBACK_|ROLLBACK_)' { return 10 }
        default { return 1 }
    }
}

function Test-MpwAdministrator {
    try {
        $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        $principal = [Security.Principal.WindowsPrincipal]::new($identity)
        return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    }
    catch {
        return $false
    }
}

function Assert-MpwAdministrator {
    if (-not (Test-MpwAdministrator)) {
        Throw-MpwFailure -Code 'ADMIN_REQUIRED' -Message 'This IIS FTP operation requires an elevated administrator process.'
    }
}

function Assert-MpwExchangePath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][ValidateSet('input', 'output')][string]$Kind,
        [switch]$MustExist
    )

    if ([string]::IsNullOrWhiteSpace($Path) -or -not [IO.Path]::IsPathRooted($Path)) {
        Throw-MpwFailure -Code 'INVALID_EXCHANGE_PATH' -Message "The $Kind JSON path must be absolute."
    }

    $fullPath = [IO.Path]::GetFullPath($Path)
    if ([IO.Path]::GetExtension($fullPath) -ne '.json') {
        Throw-MpwFailure -Code 'INVALID_EXCHANGE_PATH' -Message "The $Kind exchange file must use the .json extension."
    }

    if ($MustExist -and -not [IO.File]::Exists($fullPath)) {
        Throw-MpwFailure -Code 'INPUT_FILE_NOT_FOUND' -Message 'The input JSON file was not found.'
    }

    if ([IO.Directory]::Exists($fullPath)) {
        Throw-MpwFailure -Code 'INVALID_EXCHANGE_PATH' -Message "The $Kind exchange path cannot be a directory."
    }

    return $fullPath
}

function Remove-MpwExchangeInput {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not [IO.File]::Exists($Path)) {
        return
    }

    try {
        $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            Throw-MpwFailure -Code 'INVALID_EXCHANGE_PATH' -Message 'The input JSON file cannot be a reparse point.'
        }
        Remove-Item -LiteralPath $Path -Force -ErrorAction Stop
    }
    catch {
        if ($_.Exception.Data.Contains('MpwCode')) {
            throw
        }
        Throw-MpwFailure -Code 'TEMP_FILE_CLEANUP_FAILED' -Message 'The temporary input JSON file could not be removed.'
    }
}

function Get-MpwRestrictedExchangeSids {
    param([Parameter(Mandatory = $true)][string]$Path)

    try {
        $parentPath = [IO.Path]::GetDirectoryName($Path)
        $parentAcl = [IO.Directory]::GetAccessControl($parentPath)
        if (-not $parentAcl.AreAccessRulesProtected) {
            Throw-MpwFailure -Code 'TEMP_FILE_ACL_FAILED' -Message 'The exchange directory must not inherit access rules.'
        }
        $parentRules = @($parentAcl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
        $readMask = [Security.AccessControl.FileSystemRights]::ReadData -bor [Security.AccessControl.FileSystemRights]::Read
        $allowedSids = @($parentRules | Where-Object {
            $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
            ($_.FileSystemRights -band $readMask) -ne 0
        } | ForEach-Object { $_.IdentityReference.Value } | Select-Object -Unique)
        $fixedSids = @('S-1-5-18', 'S-1-5-32-544')
        $requesterSids = @($allowedSids | Where-Object { $fixedSids -notcontains $_ })
        if ($requesterSids.Count -ne 1 -or $requesterSids[0] -notmatch '^S-1-(5-21|12-1)-') {
            Throw-MpwFailure -Code 'TEMP_FILE_ACL_FAILED' -Message 'The exchange directory requester ACL is invalid.'
        }
        return $allowedSids
    }
    catch {
        if ($_.Exception.Data.Contains('MpwCode')) { throw }
        Throw-MpwFailure -Code 'TEMP_FILE_ACL_FAILED' -Message 'The exchange directory ACL could not be validated.'
    }
}

function Assert-MpwRestrictedInputAcl {
    param([Parameter(Mandatory = $true)][string]$Path)

    try {
        $allowedSids = @(Get-MpwRestrictedExchangeSids -Path $Path)
        $acl = [IO.File]::GetAccessControl($Path)
        $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
        $readMask = [Security.AccessControl.FileSystemRights]::ReadData -bor [Security.AccessControl.FileSystemRights]::Read
        foreach ($rule in $rules) {
            if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
                ($rule.FileSystemRights -band $readMask) -ne 0 -and
                $allowedSids -notcontains $rule.IdentityReference.Value) {
                Throw-MpwFailure -Code 'TEMP_FILE_ACL_FAILED' -Message 'The input JSON file grants read access to an unexpected Windows principal.'
            }
        }
    }
    catch {
        if ($_.Exception.Data.Contains('MpwCode')) { throw }
        Throw-MpwFailure -Code 'TEMP_FILE_ACL_FAILED' -Message 'The input JSON file ACL could not be validated.'
    }
}

function Read-MpwJsonInput {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [switch]$DeleteAfterRead
    )

    $fullPath = Assert-MpwExchangePath -Path $Path -Kind input -MustExist
    $raw = $null
    try {
        $item = Get-Item -LiteralPath $fullPath -Force -ErrorAction Stop
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            Throw-MpwFailure -Code 'INVALID_EXCHANGE_PATH' -Message 'The input JSON file cannot be a reparse point.'
        }
        Assert-MpwRestrictedInputAcl -Path $fullPath
        if ($item.Length -gt 1048576) {
            Throw-MpwFailure -Code 'INVALID_INPUT' -Message 'The input JSON file is too large.'
        }
        $raw = [IO.File]::ReadAllText($fullPath, [Text.Encoding]::UTF8)
        if ([string]::IsNullOrWhiteSpace($raw)) {
            Throw-MpwFailure -Code 'INVALID_INPUT' -Message 'The input JSON file is empty.'
        }
        try {
            return $raw | ConvertFrom-Json -ErrorAction Stop
        }
        catch {
            Throw-MpwFailure -Code 'INVALID_INPUT' -Message 'The input JSON is invalid.'
        }
    }
    finally {
        $raw = $null
        if ($DeleteAfterRead) {
            Remove-MpwExchangeInput -Path $fullPath
        }
    }
}

function Set-MpwRestrictedFileAcl {
    param([Parameter(Mandatory = $true)][string]$Path)

    try {
        # The file inherits the already protected operation-directory DACL,
        # which includes the original requester, Administrators and SYSTEM.
        # Validate rather than replacing it with only the elevated identity so
        # a standard user can read the result after supplying admin credentials.
        Assert-MpwRestrictedInputAcl -Path $Path
    }
    catch {
        Throw-MpwFailure -Code 'TEMP_FILE_ACL_FAILED' -Message 'The output JSON file ACL could not be restricted.'
    }
}

function ConvertTo-MpwSanitizedOutput {
    param([AllowNull()]$Value)

    if ($null -eq $Value -or $Value -is [string] -or $Value -is [ValueType]) {
        return $Value
    }
    if ($Value -is [Collections.IDictionary]) {
        $result = [ordered]@{}
        foreach ($key in $Value.Keys) {
            $name = [string]$key
            if ($name -match '^(?i:password|newPassword|confirmPassword|oldPassword|currentPassword|secret|token)$') { continue }
            $result[$name] = ConvertTo-MpwSanitizedOutput -Value $Value[$key]
        }
        return $result
    }
    if ($Value -is [Collections.IEnumerable]) {
        $items = [Collections.Generic.List[object]]::new()
        foreach ($item in $Value) { [void]$items.Add((ConvertTo-MpwSanitizedOutput -Value $item)) }
        return ,$items.ToArray()
    }
    $properties = @($Value.PSObject.Properties | Where-Object { $_.MemberType -match 'Property' })
    if ($properties.Count -gt 0) {
        $result = [ordered]@{}
        foreach ($property in $properties) {
            if ($property.Name -match '^(?i:password|newPassword|confirmPassword|oldPassword|currentPassword|secret|token)$') { continue }
            $result[$property.Name] = ConvertTo-MpwSanitizedOutput -Value $property.Value
        }
        return $result
    }
    return [string]$Value
}

function Write-MpwJsonOutput {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value
    )

    $fullPath = Assert-MpwExchangePath -Path $Path -Kind output
    $parent = [IO.Path]::GetDirectoryName($fullPath)
    if (-not [IO.Directory]::Exists($parent)) {
        Throw-MpwFailure -Code 'INVALID_EXCHANGE_PATH' -Message 'The output JSON directory does not exist.'
    }

    $temporaryPath = Join-Path $parent (([IO.Path]::GetFileName($fullPath)) + '.' + [Guid]::NewGuid().ToString('N') + '.tmp')
    try {
        $sanitizedValue = ConvertTo-MpwSanitizedOutput -Value $Value
        $json = $sanitizedValue | ConvertTo-Json -Depth 30 -Compress
        [IO.File]::WriteAllText($temporaryPath, $json, [Text.UTF8Encoding]::new($false))
        Set-MpwRestrictedFileAcl -Path $temporaryPath
        if ([IO.File]::Exists($fullPath)) {
            try {
                [IO.File]::Replace($temporaryPath, $fullPath, $null, $true)
            }
            catch {
                # Some Windows filesystems reject File.Replace even for a
                # same-directory file. Move-Item -Force still delegates the
                # replacement to the filesystem without exposing half JSON.
                Move-Item -LiteralPath $temporaryPath -Destination $fullPath -Force -ErrorAction Stop
            }
        }
        else {
            Move-Item -LiteralPath $temporaryPath -Destination $fullPath -Force -ErrorAction Stop
        }
    }
    catch {
        if ([IO.File]::Exists($temporaryPath)) {
            Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
        }
        if ($_.Exception.Data.Contains('MpwCode')) {
            throw
        }
        Throw-MpwFailure -Code 'OUTPUT_WRITE_FAILED' -Message 'The output JSON file could not be written.'
    }
}

function Write-MpwOperationProgress {
    param(
        [AllowNull()][string]$StatusPath,
        [AllowNull()][string]$OperationId,
        [Parameter(Mandatory = $true)][string]$Action,
        [Parameter(Mandatory = $true)][string]$Stage,
        [Parameter(Mandatory = $true)][string]$ScriptName
    )

    if ([string]::IsNullOrWhiteSpace($StatusPath) -or [string]::IsNullOrWhiteSpace($OperationId)) {
        return
    }
    $operationGuid = [Guid]::Empty
    if (-not [Guid]::TryParse($OperationId, [ref]$operationGuid)) {
        Throw-MpwFailure -Code 'INVALID_PARAMETER' -Message 'The elevated operation identifier is invalid.'
    }
    if ($Stage -notmatch '^[a-z0-9_]{1,64}$') {
        Throw-MpwFailure -Code 'INVALID_PARAMETER' -Message 'The elevated progress stage is invalid.'
    }
    $now = [DateTimeOffset]::UtcNow.ToString('o')
    $existing = $null
    try {
        if ([IO.File]::Exists($StatusPath)) {
            $existing = [IO.File]::ReadAllText($StatusPath, [Text.Encoding]::UTF8) | ConvertFrom-Json -ErrorAction Stop
        }
    }
    catch {
        # A half-written legacy status file is recoverable: the next atomic
        # stage update becomes authoritative and never reads the secret input.
        $existing = $null
    }
    $startedAt = if ($null -ne $existing -and
        $existing.PSObject.Properties.Name -contains 'startedAt' -and
        -not [string]::IsNullOrWhiteSpace([string]$existing.startedAt)) {
        [string]$existing.startedAt
    }
    else {
        $now
    }
    $progress = [ordered]@{
        operationId = $OperationId
        operation = $Action
        scriptName = $ScriptName
        stage = $Stage
        state = 'running'
        processId = $PID
        startedAt = $startedAt
        stageStartedAt = $now
        lastProgressAt = $now
        timestamp = $now
    }
    if ($null -ne $existing -and
        $existing.PSObject.Properties.Name -contains 'parentOperationId' -and
        -not [string]::IsNullOrWhiteSpace([string]$existing.parentOperationId)) {
        $progress.parentOperationId = [string]$existing.parentOperationId
    }
    Write-MpwJsonOutput -Path $StatusPath -Value $progress
}

function Write-MpwScriptResult {
    param(
        [Parameter(Mandatory = $true)][string]$OutputPath,
        [Parameter(Mandatory = $true)][string]$Action,
        [Parameter(Mandatory = $true)][bool]$Ok,
        [string]$Stage = '',
        [string]$SiteName = '',
        [AllowNull()]$Data = $null,
        [AllowNull()]$ErrorObject = $null,
        [object[]]$Warnings = @(),
        [bool]$RollbackAttempted = $false,
        [AllowNull()]$RollbackSucceeded = $null
    )

    $safeError = if ($null -ne $ErrorObject) { ConvertTo-MpwSanitizedOutput -Value $ErrorObject } else { $null }
    $code = if ($null -ne $safeError -and $safeError.code) { [string]$safeError.code } else { $null }
    $message = if ($null -ne $safeError -and $safeError.message) { [string]$safeError.message } elseif ($Ok) { 'Operation completed.' } else { 'Windows IIS FTP operation failed.' }
    $technicalMessage = if ($null -ne $safeError -and $safeError.technicalMessage) { [string]$safeError.technicalMessage } else { '' }
    $exceptionType = if ($null -ne $safeError -and $safeError.exceptionType) { [string]$safeError.exceptionType } else { '' }
    $command = if ($null -ne $safeError -and $safeError.command) { [string]$safeError.command } else { '' }
    $resolvedStage = if (-not [string]::IsNullOrWhiteSpace($Stage)) { $Stage } elseif ($Ok) { 'completed' } else { 'unknown' }
    $result = [ordered]@{
        schemaVersion = $script:MpwIisSchemaVersion
        ok = $Ok
        operation = $Action
        action = $Action
        stage = $resolvedStage
        code = $code
        message = $message
        technicalMessage = $technicalMessage
        exceptionType = $exceptionType
        command = $command
        siteName = $SiteName
        rollbackAttempted = $RollbackAttempted
        rollbackSucceeded = $RollbackSucceeded
        timestamp = [DateTimeOffset]::UtcNow.ToString('o')
        data = $Data
        error = $safeError
        warnings = @($Warnings)
    }
    try {
        Write-MpwJsonOutput -Path $OutputPath -Value $result
    }
    catch {
        # The structured failure is more useful than a bare process exit. The
        # exchange directory is already protected by the Node launcher, so use
        # a final direct UTF-8 write if the atomic helper itself fails.
        $fullOutputPath = Assert-MpwExchangePath -Path $OutputPath -Kind output
        $sanitizedResult = ConvertTo-MpwSanitizedOutput -Value $result
        $json = $sanitizedResult | ConvertTo-Json -Depth 30 -Compress
        [IO.File]::WriteAllText($fullOutputPath, $json, [Text.UTF8Encoding]::new($false))
    }
}

function Assert-MpwAction {
    param(
        [AllowNull()]$InputObject,
        [Parameter(Mandatory = $true)][string[]]$AllowedActions
    )

    $action = [string](Get-MpwInputValue -InputObject $InputObject -Name 'action' -DefaultValue '')
    $action = $action.Trim().ToLowerInvariant()
    if ([string]::IsNullOrWhiteSpace($action) -or $AllowedActions -notcontains $action) {
        Throw-MpwFailure -Code 'INVALID_ACTION' -Message 'The requested action is not allowed for this script.'
    }
    return $action
}

function Assert-MpwAllowedInputProperties {
    param(
        [Parameter(Mandatory = $true)]$InputObject,
        [Parameter(Mandatory = $true)][string[]]$AllowedProperties
    )

    foreach ($property in $InputObject.PSObject.Properties) {
        if ($AllowedProperties -notcontains [string]$property.Name) {
            Throw-MpwFailure -Code 'INVALID_PARAMETER' -Message 'The input JSON contains a parameter that is not allowed for this script.'
        }
    }
}

function Get-MpwCommonInputProperties {
    return @(
        'action',
        'requestId',
        'siteName',
        'managedSiteId',
        'username',
        'physicalPath',
        'controlPort',
        'passivePortStart',
        'passivePortEnd',
        'firewallControlRuleName',
        'firewallPassiveRuleName',
        'firewallProfile',
        'firewallRemoteAddress',
        'accountDescription',
        'binding',
        'activeEventId'
    )
}

function Assert-MpwSiteName {
    param([Parameter(Mandatory = $true)][string]$SiteName)

    $value = $SiteName.Trim()
    if ($value.Length -lt 1 -or $value.Length -gt 128 -or $value -match '[\x00-\x1f\\/]') {
        Throw-MpwFailure -Code 'INVALID_SITE_NAME' -Message 'The IIS FTP site name is invalid.'
    }
    return $value
}

function Assert-MpwUsername {
    param([Parameter(Mandatory = $true)][string]$Username)

    $value = $Username.Trim()
    if ($value.Length -lt 1 -or $value.Length -gt 20 -or $value -match '["/\\\[\]:;|=,+*?<>@]' -or $value -match '[\.\s]$' -or $value -match '^\.+$') {
        Throw-MpwFailure -Code 'FTP_USERNAME_INVALID' -Message 'The local FTP username is invalid.'
    }
    return $value
}

function Test-MpwUnsafeReparsePoint {
    param([Parameter(Mandatory = $true)]$Item)

    if (($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) {
        return $false
    }

    # OneDrive Files On-Demand directories are marked as reparse points even
    # though they are not path redirects. PowerShell exposes actual symbolic
    # links and junctions through LinkType/Target; only those are unsafe for an
    # IIS physical path. This keeps cloud-backed repositories usable without
    # allowing a link to escape the selected event directory.
    $linkTypeProperty = $Item.PSObject.Properties['LinkType']
    $targetProperty = $Item.PSObject.Properties['Target']
    $linkType = if ($null -ne $linkTypeProperty) { [string]$linkTypeProperty.Value } else { '' }
    $targets = if ($null -ne $targetProperty) { @($targetProperty.Value) } else { @() }
    $hasTarget = @($targets | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }).Count -gt 0
    return -not [string]::IsNullOrWhiteSpace($linkType) -or $hasTarget
}

function Assert-MpwPathAncestorsSafe {
    param([Parameter(Mandatory = $true)][string]$FullPath)

    $root = [IO.Path]::GetPathRoot($FullPath)
    $candidate = $FullPath.TrimEnd('\')
    while (-not [string]::IsNullOrWhiteSpace($candidate)) {
        if ([IO.Directory]::Exists($candidate)) {
            $item = Get-Item -LiteralPath $candidate -Force -ErrorAction Stop
            if (Test-MpwUnsafeReparsePoint -Item $item) {
                Throw-MpwFailure -Code 'FTP_PATH_INVALID' -Message 'The FTP physical path cannot traverse a symbolic link or junction.' -Details ([ordered]@{
                    path = $FullPath
                    reparsePoint = $candidate
                })
            }
        }
        if ($candidate.TrimEnd('\') -eq $root.TrimEnd('\')) { break }
        $parent = [IO.Path]::GetDirectoryName($candidate)
        if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $candidate) { break }
        $candidate = $parent.TrimEnd('\')
    }
}

function Assert-MpwPhysicalPath {
    param(
        [Parameter(Mandatory = $true)][string]$PhysicalPath,
        [switch]$AllowMissing
    )

    if ([string]::IsNullOrWhiteSpace($PhysicalPath) -or -not [IO.Path]::IsPathRooted($PhysicalPath)) {
        Throw-MpwFailure -Code 'FTP_PATH_INVALID' -Message 'The FTP physical path must be an absolute path.'
    }

    try {
        $fullPath = [IO.Path]::GetFullPath($PhysicalPath.Trim())
    }
    catch {
        Throw-MpwFailure -Code 'FTP_PATH_INVALID' -Message 'The FTP physical path is invalid.'
    }

    $root = [IO.Path]::GetPathRoot($fullPath)
    if ($fullPath.TrimEnd('\') -eq $root.TrimEnd('\')) {
        Throw-MpwFailure -Code 'FTP_PATH_INVALID' -Message 'A drive root cannot be used as the FTP physical path.'
    }

    if (-not [IO.Directory]::Exists($fullPath)) {
        if ($AllowMissing) {
            return $fullPath
        }
        Throw-MpwFailure -Code 'FTP_PATH_INVALID' -Message 'The FTP physical path does not exist.'
    }

    Assert-MpwPathAncestorsSafe -FullPath $fullPath
    return $fullPath
}

function Get-MpwNormalizedOptions {
    param(
        [AllowNull()]$InputObject,
        [switch]$RequirePath
    )

    $siteName = Assert-MpwSiteName -SiteName ([string](Get-MpwInputValue -InputObject $InputObject -Name 'siteName' -DefaultValue $script:MpwDefaultSiteName))
    $managedSiteIdText = [string](Get-MpwInputValue -InputObject $InputObject -Name 'managedSiteId' -DefaultValue '0')
    $managedSiteId = 0L
    if (-not [long]::TryParse($managedSiteIdText, [Globalization.NumberStyles]::Integer, [Globalization.CultureInfo]::InvariantCulture, [ref]$managedSiteId) -or $managedSiteId -lt 0) {
        Throw-MpwFailure -Code 'INVALID_PARAMETER' -Message 'managedSiteId must be a non-negative integer.'
    }
    $username = Assert-MpwUsername -Username ([string](Get-MpwInputValue -InputObject $InputObject -Name 'username' -DefaultValue $script:MpwDefaultUsername))
    $controlPort = 0
    $passiveStart = 0
    $passiveEnd = 0
    $controlPortText = [string](Get-MpwInputValue -InputObject $InputObject -Name 'controlPort' -DefaultValue $script:MpwControlPort)
    $passiveStartText = [string](Get-MpwInputValue -InputObject $InputObject -Name 'passivePortStart' -DefaultValue $script:MpwPassivePortStart)
    $passiveEndText = [string](Get-MpwInputValue -InputObject $InputObject -Name 'passivePortEnd' -DefaultValue $script:MpwPassivePortEnd)
    if (-not [int]::TryParse($controlPortText, [Globalization.NumberStyles]::Integer, [Globalization.CultureInfo]::InvariantCulture, [ref]$controlPort) -or $controlPort -lt 1 -or $controlPort -gt 65535) {
        Throw-MpwFailure -Code 'FTP_CONTROL_PORT_INVALID' -Message 'The FTP control port must be an integer from 1 to 65535.' -Details ([ordered]@{ controlPort = $controlPortText })
    }
    if (-not [int]::TryParse($passiveStartText, [Globalization.NumberStyles]::Integer, [Globalization.CultureInfo]::InvariantCulture, [ref]$passiveStart) -or $passiveStart -lt 1 -or $passiveStart -gt 65535 -or -not [int]::TryParse($passiveEndText, [Globalization.NumberStyles]::Integer, [Globalization.CultureInfo]::InvariantCulture, [ref]$passiveEnd) -or $passiveEnd -lt 1 -or $passiveEnd -gt 65535 -or $passiveStart -gt $passiveEnd) {
        Throw-MpwFailure -Code 'FTP_PORT_RANGE_CONFLICT' -Message 'The FTP passive port range is invalid.' -Details ([ordered]@{ controlPort = $controlPort; passivePortStart = $passiveStartText; passivePortEnd = $passiveEndText })
    }
    if ($controlPort -ge $passiveStart -and $controlPort -le $passiveEnd) {
        Throw-MpwFailure -Code 'FTP_PORT_RANGE_CONFLICT' -Message 'The FTP control port cannot overlap the passive port range.' -Details ([ordered]@{ controlPort = $controlPort; passivePortStart = $passiveStart; passivePortEnd = $passiveEnd })
    }
    $expectedBinding = "*:$controlPort`:"
    $binding = [string](Get-MpwInputValue -InputObject $InputObject -Name 'binding' -DefaultValue $expectedBinding)
    $accountDescription = [string](Get-MpwInputValue -InputObject $InputObject -Name 'accountDescription' -DefaultValue $script:MpwManagedAccountDescription)
    $firewallProfile = [string](Get-MpwInputValue -InputObject $InputObject -Name 'firewallProfile' -DefaultValue 'Any')
    $firewallRemoteAddress = [string](Get-MpwInputValue -InputObject $InputObject -Name 'firewallRemoteAddress' -DefaultValue 'LocalSubnet')
    if ($binding -ne $expectedBinding) {
        Throw-MpwFailure -Code 'FTP_BINDING_FAILED' -Message 'The FTP binding must use all unassigned addresses and the configured control port.'
    }
    if ($accountDescription -ne $script:MpwManagedAccountDescription) {
        Throw-MpwFailure -Code 'FTP_ACCOUNT_CONFLICT' -Message 'The managed FTP account description marker is invalid.'
    }
    if ($firewallProfile -ne 'Any' -or $firewallRemoteAddress -ne 'LocalSubnet') {
        Throw-MpwFailure -Code 'FIREWALL_CONFIG_FAILED' -Message 'Media Photo Workbench firewall rules must use profile Any and remote scope LocalSubnet.'
    }

    $physicalPath = [string](Get-MpwInputValue -InputObject $InputObject -Name 'physicalPath' -DefaultValue '')
    if ($RequirePath -and [string]::IsNullOrWhiteSpace($physicalPath)) {
        Throw-MpwFailure -Code 'FTP_PATH_INVALID' -Message 'An FTP physical path is required.'
    }

    return [pscustomobject][ordered]@{
        SiteName = $siteName
        ManagedSiteId = $managedSiteId
        Username = $username
        PhysicalPath = $physicalPath
        Binding = $binding
        ControlPort = $controlPort
        PassivePortStart = $passiveStart
        PassivePortEnd = $passiveEnd
        FirewallControlRuleName = [string](Get-MpwInputValue -InputObject $InputObject -Name 'firewallControlRuleName' -DefaultValue 'Media Photo Workbench - FTP Control')
        FirewallPassiveRuleName = [string](Get-MpwInputValue -InputObject $InputObject -Name 'firewallPassiveRuleName' -DefaultValue 'Media Photo Workbench - FTP Passive')
        AccountDescription = $accountDescription
        FirewallProfile = $firewallProfile
        FirewallRemoteAddress = $firewallRemoteAddress
    }
}

function Import-MpwLocalAccountsModule {
    try {
        Import-Module Microsoft.PowerShell.LocalAccounts -ErrorAction Stop
    }
    catch {
        Throw-MpwFailure -Code 'FTP_ACCOUNT_CREATE_FAILED' -Message 'The Windows LocalAccounts module is unavailable.'
    }
}

function Get-MpwLocalAccount {
    param([Parameter(Mandatory = $true)][string]$Username)

    Import-MpwLocalAccountsModule
    return Get-LocalUser -Name $Username -ErrorAction SilentlyContinue
}

function Get-MpwLocalAccountStatus {
    param([Parameter(Mandatory = $true)][string]$Username)

    try {
        $user = Get-MpwLocalAccount -Username $Username
        if ($null -eq $user) {
            return [ordered]@{
                detection = 'available'
                exists = $false
                username = $Username
                enabled = $null
                description = $null
                isManaged = $false
                managed = $false
                conflict = $false
            }
        }
        $description = [string]$user.Description
        return [ordered]@{
            detection = 'available'
            exists = $true
            username = [string]$user.Name
            enabled = [bool]$user.Enabled
            description = $description
            isManaged = $description -eq $script:MpwManagedAccountDescription
            managed = $description -eq $script:MpwManagedAccountDescription
            conflict = $description -ne $script:MpwManagedAccountDescription
        }
    }
    catch {
        return [ordered]@{
            detection = 'unknown'
            exists = $null
            username = $Username
            enabled = $null
            description = $null
            isManaged = $null
            managed = $null
            conflict = $null
            errorCode = 'FTP_ACCOUNT_STATUS_FAILED'
        }
    }
}





function Get-MpwAccountSid {
    param([Parameter(Mandatory = $true)][string]$Username)

    try {
        $account = [Security.Principal.NTAccount]::new($env:COMPUTERNAME, $Username)
        return $account.Translate([Security.Principal.SecurityIdentifier])
    }
    catch {
        Throw-MpwFailure -Code 'FTP_ACCOUNT_NOT_FOUND' -Message 'The managed FTP account SID could not be resolved.'
    }
}

function Get-MpwAccountEffectivePrincipalSids {
    param([Parameter(Mandatory = $true)][string]$Username)

    $cacheKey = $Username.Trim().ToLowerInvariant()
    if ($script:MpwEffectivePrincipalSidCache.ContainsKey($cacheKey)) {
        return @($script:MpwEffectivePrincipalSidCache[$cacheKey])
    }
    $accountSid = Get-MpwAccountSid -Username $Username
    $effectiveSids = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($sid in @(
        [string]$accountSid.Value,
        'S-1-1-0',       # Everyone
        'S-1-5-11',      # Authenticated Users
        'S-1-5-32-545'   # BUILTIN\Users
    )) {
        [void]$effectiveSids.Add($sid)
    }

    try {
        Import-MpwLocalAccountsModule
        $groups = @(Get-LocalGroup -ErrorAction Stop)
        $membersByGroupSid = @{}
        foreach ($group in $groups) {
            $groupSid = [string]$group.SID.Value
            try {
                $membersByGroupSid[$groupSid] = @(
                    Get-LocalGroupMember -Group $group -ErrorAction Stop |
                        ForEach-Object { [string]$_.SID.Value } |
                        Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
                )
            }
            catch {
                $membersByGroupSid[$groupSid] = @()
            }
        }

        $changed = $true
        while ($changed) {
            $changed = $false
            foreach ($groupSid in @($membersByGroupSid.Keys)) {
                if ($effectiveSids.Contains($groupSid)) { continue }
                if (@($membersByGroupSid[$groupSid] | Where-Object { $effectiveSids.Contains([string]$_) }).Count -gt 0) {
                    [void]$effectiveSids.Add($groupSid)
                    $changed = $true
                }
            }
        }
    }
    catch {
        # The well-known token groups above are still sufficient to detect the
        # most common inherited deny rules. Failure to enumerate optional local
        # groups must not erase those conservative checks.
    }

    $result = @($effectiveSids)
    $script:MpwEffectivePrincipalSidCache[$cacheKey] = $result
    return $result
}

function Get-MpwAclModifyAccessForSids {
    param(
        [Parameter(Mandatory = $true)]$Acl,
        [Parameter(Mandatory = $true)][string[]]$PrincipalSids,
        [switch]$InheritedOnly
    )

    $principalSet = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($principalSid in @($PrincipalSids)) {
        if (-not [string]::IsNullOrWhiteSpace([string]$principalSid)) {
            [void]$principalSet.Add([string]$principalSid)
        }
    }
    $modifyMask = ConvertTo-MpwUnsignedAccessMask -AccessMask ([int][Security.AccessControl.FileSystemRights]::Modify)
    $allowMask = [uint64]0
    $denyMask = [uint64]0
    foreach ($rule in @($Acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))) {
        if ($InheritedOnly -and -not $rule.IsInherited) { continue }
        if (-not $principalSet.Contains([string]$rule.IdentityReference.Value)) { continue }
        $ruleMask = ConvertTo-MpwUnsignedAccessMask -AccessMask ([int]$rule.FileSystemRights)
        if ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Deny) {
            $denyMask = $denyMask -bor ($ruleMask -band $modifyMask)
        }
        elseif ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow) {
            $allowMask = $allowMask -bor ($ruleMask -band $modifyMask)
        }
    }
    return [ordered]@{
        allowed = [bool](($allowMask -band $modifyMask) -eq $modifyMask -and ($denyMask -band $modifyMask) -eq 0)
        allowMask = $allowMask
        denyMask = $denyMask
        principalSids = @($principalSet)
    }
}

function Get-MpwDirectoryAclDiagnostics {
    param([Parameter(Mandatory = $true)][string]$PhysicalPath)

    $details = [ordered]@{
        path = $PhysicalPath
        exists = [IO.Directory]::Exists($PhysicalPath)
        owner = ''
        protected = $null
        canonical = $null
        ruleCount = 0
        nullDacl = $null
        orphanSidCount = 0
        attributes = ''
        reparsePoint = $false
        oneDrivePath = $false
        rules = @()
        inspectionError = ''
    }
    if (-not $details.exists) { return $details }

    try {
        $item = Get-Item -LiteralPath $PhysicalPath -Force -ErrorAction Stop
        $details.attributes = [string]$item.Attributes
        $details.reparsePoint = ([IO.FileAttributes]$item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
        $oneDriveRoots = @($env:OneDrive, $env:OneDriveConsumer, $env:OneDriveCommercial) | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }
        $details.oneDrivePath = @($oneDriveRoots | Where-Object {
            $PhysicalPath.StartsWith(([IO.Path]::GetFullPath([string]$_).TrimEnd('\') + '\'), [StringComparison]::OrdinalIgnoreCase)
        }).Count -gt 0

        $acl = [IO.Directory]::GetAccessControl($PhysicalPath)
        $details.owner = [string]$acl.Owner
        $details.protected = [bool]$acl.AreAccessRulesProtected
        $details.canonical = [bool]$acl.AreAccessRulesCanonical
        $rawAcl = [Security.AccessControl.RawSecurityDescriptor]::new(
            $acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)
        )
        $details.nullDacl = $null -eq $rawAcl.DiscretionaryAcl
        $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
        $details.ruleCount = $rules.Count
        $orphanSidCount = 0
        $details.rules = @($rules | ForEach-Object {
            $identity = [string]$_.IdentityReference.Value
            $resolved = ''
            try { $resolved = [string]$_.IdentityReference.Translate([Security.Principal.NTAccount]).Value } catch { $orphanSidCount++ }
            [ordered]@{
                identity = $identity
                resolvedIdentity = $resolved
                rights = [string]$_.FileSystemRights
                accessType = [string]$_.AccessControlType
                inherited = [bool]$_.IsInherited
                inheritanceFlags = [string]$_.InheritanceFlags
                propagationFlags = [string]$_.PropagationFlags
            }
        })
        $details.orphanSidCount = $orphanSidCount
    }
    catch {
        $diagnostic = Get-MpwExceptionDiagnosticDetails -ErrorRecord $_
        $details.inspectionError = [string]$diagnostic.technicalMessage
    }
    return $details
}






function ConvertTo-MpwUnsignedAccessMask {
    param([Parameter(Mandatory = $true)][int]$AccessMask)

    return [uint64][BitConverter]::ToUInt32([BitConverter]::GetBytes($AccessMask), 0)
}

function Test-MpwWriteCapableAccessMask {
    param([Parameter(Mandatory = $true)][int]$AccessMask)

    # Keep the mask unsigned without casting a negative GENERIC_* combination
    # directly to UInt32 (Windows PowerShell 5.1 rejects that conversion).
    $mask = ConvertTo-MpwUnsignedAccessMask -AccessMask $AccessMask
    $writeMask = [uint64]0x10000000 + # GENERIC_ALL
        [uint64]0x40000000 +          # GENERIC_WRITE
        [uint64]0x00000002 +          # FILE_WRITE_DATA
        [uint64]0x00000004 +          # FILE_APPEND_DATA
        [uint64]0x00000010 +          # FILE_WRITE_EA
        [uint64]0x00000040 +          # FILE_DELETE_CHILD
        [uint64]0x00000100 +          # FILE_WRITE_ATTRIBUTES
        [uint64]0x00010000 +          # DELETE
        [uint64]0x00040000 +          # WRITE_DAC
        [uint64]0x00080000            # WRITE_OWNER
    return (($mask -band $writeMask) -ne 0)
}







function Test-MpwWriteCapableFileSystemRights {
    param([Parameter(Mandatory = $true)][Security.AccessControl.FileSystemRights]$Rights)

    return Test-MpwWriteCapableAccessMask -AccessMask ([int]$Rights)
}

function Get-MpwBroadDirectoryWriteRules {
    param([Parameter(Mandatory = $true)]$Acl)

    $broadSids = @('S-1-1-0', 'S-1-5-11', 'S-1-5-32-545')
    return @($Acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | Where-Object {
        $broadSids -contains [string]$_.IdentityReference.Value -and
        $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
        (Test-MpwWriteCapableAccessMask -AccessMask ([int]$_.FileSystemRights))
    })
}



function Get-MpwDirectoryAclStatus {
    param(
        [AllowNull()][string]$PhysicalPath,
        [Parameter(Mandatory = $true)][string]$Username
    )

    if ([string]::IsNullOrWhiteSpace($PhysicalPath) -or -not [IO.Directory]::Exists($PhysicalPath)) {
        return [ordered]@{
            detection = 'available'
            path = $PhysicalPath
            exists = $false
            readWriteAllowed = $false
            inheritedModifyAllowed = $false
            read = $false
            write = $false
            correct = $false
            broadInheritedAccess = $null
            nullDacl = $null
            rules = @()
        }
    }

    try {
        $principalSids = @()
        try { $principalSids = @(Get-MpwAccountEffectivePrincipalSids -Username $Username) } catch {}
        $acl = [IO.Directory]::GetAccessControl($PhysicalPath)
        $rawAcl = [Security.AccessControl.RawSecurityDescriptor]::new(
            $acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)
        )
        $nullDacl = $null -eq $rawAcl.DiscretionaryAcl
        $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
        $effectiveAccess = if ($nullDacl) {
            [ordered]@{ allowed = $true; allowMask = [uint64]0; denyMask = [uint64]0; principalSids = @($principalSids) }
        }
        elseif ($principalSids.Count -gt 0) {
            Get-MpwAclModifyAccessForSids -Acl $acl -PrincipalSids $principalSids
        }
        else {
            [ordered]@{ allowed = $false; allowMask = [uint64]0; denyMask = [uint64]0; principalSids = @() }
        }
        $inheritedAccess = if (-not $acl.AreAccessRulesProtected -and $principalSids.Count -gt 0) {
            Get-MpwAclModifyAccessForSids -Acl $acl -PrincipalSids $principalSids -InheritedOnly
        }
        else {
            [ordered]@{ allowed = $false }
        }
        $inheritedModifyAllowed = [bool]($effectiveAccess.allowed -and $inheritedAccess.allowed)
        $broad = @(Get-MpwBroadDirectoryWriteRules -Acl $acl)
        return [ordered]@{
            detection = 'available'
            path = $PhysicalPath
            exists = $true
            owner = [string]$acl.Owner
            protected = [bool]$acl.AreAccessRulesProtected
            readWriteAllowed = [bool]$effectiveAccess.allowed
            inheritedModifyAllowed = $inheritedModifyAllowed
            read = [bool]$effectiveAccess.allowed
            write = [bool]$effectiveAccess.allowed
            correct = $inheritedModifyAllowed
            broadInheritedAccess = [bool]($nullDacl -or $broad.Count -gt 0)
            nullDacl = [bool]$nullDacl
            effectivePrincipalSids = @($effectiveAccess.principalSids)
            deniedModifyMask = [uint64]$effectiveAccess.denyMask
            rules = @($rules | ForEach-Object {
                [ordered]@{
                    identity = $_.IdentityReference.Value
                    rights = [string]$_.FileSystemRights
                    accessType = [string]$_.AccessControlType
                    inherited = [bool]$_.IsInherited
                }
            })
        }
    }
    catch {
        return [ordered]@{
            detection = 'unknown'
            path = $PhysicalPath
            exists = $true
            readWriteAllowed = $null
            inheritedModifyAllowed = $null
            read = $null
            write = $null
            correct = $null
            broadInheritedAccess = $null
            nullDacl = $null
            rules = @()
            errorCode = 'FTP_ACL_STATUS_FAILED'
        }
    }
}

function Import-MpwIisAdministration {
    $dll = Join-Path $env:windir 'System32\inetsrv\Microsoft.Web.Administration.dll'
    if (-not [IO.File]::Exists($dll)) {
        Throw-MpwFailure -Code 'IIS_MANAGEMENT_API_NOT_READY' -Message 'Microsoft.Web.Administration is not installed or has not finished initializing.'
    }
    try {
        [void][Reflection.Assembly]::LoadFrom($dll)
    }
    catch {
        $diagnostic = Get-MpwExceptionDiagnosticDetails -ErrorRecord $_
        Throw-MpwFailure -Code 'IIS_MANAGEMENT_API_NOT_READY' -Message 'Microsoft.Web.Administration could not be loaded.' -Details $diagnostic
    }
}

function Open-MpwServerManager {
    Import-MpwIisAdministration
    $configurationPath = Join-Path $env:windir 'System32\inetsrv\config\applicationHost.config'
    $configurationStream = $null
    try {
        $configurationStream = [IO.File]::Open($configurationPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    }
    catch [System.UnauthorizedAccessException] {
        Throw-MpwFailure -Code 'ADMIN_REQUIRED' -Message 'IIS configuration requires administrator access on this computer.'
    }
    catch [System.IO.FileNotFoundException] {
        Throw-MpwFailure -Code 'IIS_CONFIGURATION_NOT_READY' -Message 'The IIS applicationHost.config file has not been generated yet.'
    }
    catch {
        $diagnostic = Get-MpwExceptionDiagnosticDetails -ErrorRecord $_
        Throw-MpwFailure -Code 'IIS_SYSTEM_CONFIGURATION_DAMAGED' -Message 'The IIS applicationHost.config file is locked, unreadable or damaged.' -Details $diagnostic
    }
    finally {
        if ($null -ne $configurationStream) { $configurationStream.Dispose() }
    }
    try {
        return [Microsoft.Web.Administration.ServerManager]::new()
    }
    catch [System.UnauthorizedAccessException] {
        Throw-MpwFailure -Code 'ADMIN_REQUIRED' -Message 'IIS configuration requires administrator access on this computer.'
    }
    catch {
        $diagnostic = Get-MpwExceptionDiagnosticDetails -ErrorRecord $_
        Throw-MpwFailure -Code 'IIS_SYSTEM_CONFIGURATION_DAMAGED' -Message 'IIS configuration could not be parsed or opened safely.' -Details $diagnostic
    }
}

function Get-MpwBindingPort {
    param([Parameter(Mandatory = $true)][string]$BindingInformation)

    if ($BindingInformation -match '^(.+):(\d+):(.*)$') {
        return [int]$Matches[2]
    }
    return $null
}

function Get-MpwFtpSiteElement {
    param([Parameter(Mandatory = $true)]$Site)

    return $Site.GetChildElement('ftpServer')
}

function ConvertTo-MpwFtpSiteRuntimeState {
    param([AllowNull()]$Value)

    # Microsoft.Web.Administration exposes the FTP runtime state as the
    # ftpServer.state enum. Depending on the Windows/IIS build and the way the
    # configuration element is marshalled into Windows PowerShell 5.1, that
    # enum can arrive either as its name or as its numeric value.  Treating the
    # numeric value as a free-form string caused a running site (1 = Started)
    # to be reported as failed and rolled back.
    $raw = if ($null -eq $Value) { '' } else { [string]$Value }
    switch -Regex ($raw.Trim()) {
        '^(?i:Starting|0)$' { return 'Starting' }
        '^(?i:Started|1)$'  { return 'Started' }
        '^(?i:Stopping|2)$' { return 'Stopping' }
        '^(?i:Stopped|3)$'  { return 'Stopped' }
        '^(?i:Unknown|4)$'  { return 'Unknown' }
        default             { return 'Unknown' }
    }
}

function Get-MpwFtpSiteRuntimeState {
    param([Parameter(Mandatory = $true)]$Site)

    try {
        return ConvertTo-MpwFtpSiteRuntimeState -Value ((Get-MpwFtpSiteElement -Site $Site)['state'])
    }
    catch {
        return 'Unknown'
    }
}

function Get-MpwFtpSiteAutoStart {
    param([Parameter(Mandatory = $true)]$Site)

    try {
        return [bool](Get-MpwFtpSiteElement -Site $Site)['serverAutoStart']
    }
    catch {
        return $false
    }
}

function Get-MpwFtpAuthorizationSection {
    param(
        [Parameter(Mandatory = $true)]$Manager,
        [Parameter(Mandatory = $true)][string]$SiteName
    )

    # FTP authorization is a location-scoped system.ftpServer section. It is
    # not a child element of system.applicationHost/sites/.../ftpServer/security.
    return $Manager.GetApplicationHostConfiguration().GetSection('system.ftpServer/security/authorization', $SiteName)
}

function Get-MpwIisSiteIdentityModel {
    param([Parameter(Mandatory = $true)]$Site)

    $rootApplication = $Site.Applications['/']
    $rootVirtualDirectory = $null
    if ($null -ne $rootApplication) { $rootVirtualDirectory = $rootApplication.VirtualDirectories['/'] }
    $bindings = @($Site.Bindings | ForEach-Object {
        [ordered]@{
            protocol = [string]$_.Protocol
            bindingInformation = [string]$_.BindingInformation
            port = Get-MpwBindingPort -BindingInformation ([string]$_.BindingInformation)
        }
    })

    return [ordered]@{
        name = [string]$Site.Name
        id = [long]$Site.Id
        state = Get-MpwFtpSiteRuntimeState -Site $Site
        serverAutoStart = Get-MpwFtpSiteAutoStart -Site $Site
        physicalPath = if ($null -ne $rootVirtualDirectory) { [Environment]::ExpandEnvironmentVariables([string]$rootVirtualDirectory.PhysicalPath) } else { $null }
        bindings = $bindings
        hasFtpBinding = @($bindings | Where-Object { $_.protocol -eq 'ftp' }).Count -gt 0
    }
}

function ConvertTo-MpwFtpSslPolicyName {
    param(
        [AllowNull()]$Value,
        [Parameter(Mandatory = $true)][ValidateSet('control', 'data')][string]$Channel
    )

    # Microsoft.Web.Administration on Windows PowerShell 5.1 may expose IIS
    # enum attributes as their numeric schema values instead of their names.
    # Keep a single canonical representation for status and verification.
    $raw = [string]$Value
    switch ($raw.Trim()) {
        '0' { return 'SslAllow' }
        '1' { return 'SslRequire' }
        '2' { if ($Channel -eq 'control') { return 'SslRequireCredentialsOnly' }; return 'SslDeny' }
        'SslAllow' { return 'SslAllow' }
        'SslRequire' { return 'SslRequire' }
        'SslRequireCredentialsOnly' { return 'SslRequireCredentialsOnly' }
        'SslDeny' { return 'SslDeny' }
        default { return $raw }
    }
}

function ConvertTo-MpwFtpAuthorizationAccessTypeName {
    param([AllowNull()]$Value)

    $raw = [string]$Value
    switch ($raw.Trim()) {
        '0' { return 'Allow' }
        '1' { return 'Deny' }
        'Allow' { return 'Allow' }
        'Deny' { return 'Deny' }
        default { return $raw }
    }
}

function ConvertTo-MpwFtpAuthorizationPermissionsName {
    param([AllowNull()]$Value)

    $raw = [string]$Value
    $numeric = 0
    if ([int]::TryParse($raw.Trim(), [ref]$numeric)) {
        $names = [Collections.Generic.List[string]]::new()
        if (($numeric -band 1) -eq 1) { [void]$names.Add('Read') }
        if (($numeric -band 2) -eq 2) { [void]$names.Add('Write') }
        if ($names.Count -gt 0) { return [string]::Join(', ', @($names)) }
        if ($numeric -eq 0) { return 'None' }
        return $raw
    }

    $names = [Collections.Generic.List[string]]::new()
    if ($raw -match '(?i)(^|[^A-Za-z])Read([^A-Za-z]|$)') { [void]$names.Add('Read') }
    if ($raw -match '(?i)(^|[^A-Za-z])Write([^A-Za-z]|$)') { [void]$names.Add('Write') }
    if ($names.Count -gt 0) { return [string]::Join(', ', @($names)) }
    return $raw
}

function Get-MpwFtpAuthorizationPrincipalNames {
    param([Parameter(Mandatory = $true)][string]$Username)

    $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($name in @($Username, ".\$Username", "$env:COMPUTERNAME\$Username")) {
        if (-not [string]::IsNullOrWhiteSpace([string]$name)) { [void]$names.Add([string]$name) }
    }
    try {
        foreach ($sidValue in @(Get-MpwAccountEffectivePrincipalSids -Username $Username)) {
            try {
                $accountName = [string]([Security.Principal.SecurityIdentifier]::new([string]$sidValue)).Translate([Security.Principal.NTAccount]).Value
                if (-not [string]::IsNullOrWhiteSpace($accountName)) {
                    [void]$names.Add($accountName)
                    if ($accountName.Contains('\')) {
                        [void]$names.Add($accountName.Substring($accountName.LastIndexOf('\') + 1))
                    }
                }
            }
            catch {}
        }
    }
    catch {}
    return @($names)
}

function Get-MpwFtpAuthorizationTokens {
    param([AllowNull()][string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) { return @() }
    return @($Value -split '[,;]' | ForEach-Object { $_.Trim() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Get-MpwFtpAuthorizationEvaluation {
    param(
        [Parameter(Mandatory = $true)][object[]]$Rules,
        [Parameter(Mandatory = $true)][string]$Username
    )

    $principalNames = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($name in @(Get-MpwFtpAuthorizationPrincipalNames -Username $Username)) {
        [void]$principalNames.Add([string]$name)
    }
    $exactManagedUserNames = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($name in @($Username, ".\$Username", "$env:COMPUTERNAME\$Username")) {
        if (-not [string]::IsNullOrWhiteSpace([string]$name)) {
            [void]$exactManagedUserNames.Add([string]$name)
        }
    }
    $managedAllow = $false
    $conflicts = [Collections.Generic.List[object]]::new()
    foreach ($rule in @($Rules)) {
        $accessType = [string](Get-MpwInputValue -InputObject $rule -Name 'accessType' -DefaultValue '')
        $permissions = [string](Get-MpwInputValue -InputObject $rule -Name 'permissions' -DefaultValue '')
        $users = @(Get-MpwFtpAuthorizationTokens -Value ([string](Get-MpwInputValue -InputObject $rule -Name 'users' -DefaultValue '')))
        $roles = @(Get-MpwFtpAuthorizationTokens -Value ([string](Get-MpwInputValue -InputObject $rule -Name 'roles' -DefaultValue '')))
        $grantsReadWrite = $permissions -match '(?i)(^|[^A-Za-z])Read([^A-Za-z]|$)' -and
            $permissions -match '(?i)(^|[^A-Za-z])Write([^A-Za-z]|$)'
        $targetsExactManagedUser = @($users | Where-Object { $exactManagedUserNames.Contains([string]$_) }).Count -gt 0
        if ($accessType -eq 'Allow' -and $targetsExactManagedUser -and $grantsReadWrite) {
            $managedAllow = $true
        }
        if ($accessType -ne 'Deny' -or $permissions -notmatch '(?i)(^|[^A-Za-z])(Read|Write)([^A-Za-z]|$)') {
            continue
        }
        $denyApplies = @($users | Where-Object { $_ -eq '*' -or $principalNames.Contains([string]$_) }).Count -gt 0 -or
            @($roles | Where-Object { $_ -eq '*' -or $principalNames.Contains([string]$_) }).Count -gt 0
        if ($denyApplies) {
            [void]$conflicts.Add([ordered]@{
                accessType = $accessType
                users = [string](Get-MpwInputValue -InputObject $rule -Name 'users' -DefaultValue '')
                roles = [string](Get-MpwInputValue -InputObject $rule -Name 'roles' -DefaultValue '')
                permissions = $permissions
            })
        }
    }
    return [ordered]@{
        correct = [bool]($managedAllow -and $conflicts.Count -eq 0)
        managedAllow = [bool]$managedAllow
        conflictingDeny = $conflicts.Count -gt 0
        conflicts = @($conflicts)
        principalNames = @($principalNames)
    }
}

function New-MpwVerificationCheck {
    param(
        [Parameter(Mandatory = $true)][string]$Id,
        [Parameter(Mandatory = $true)][string]$Code,
        [Parameter(Mandatory = $true)][bool]$Passed,
        [AllowNull()]$Expected = $null,
        [AllowNull()]$Actual = $null
    )

    return [ordered]@{
        id = $Id
        code = $Code
        passed = $Passed
        expected = $Expected
        actual = $Actual
    }
}

function Get-MpwFtpSiteModel {
    param(
        [Parameter(Mandatory = $true)]$Manager,
        [Parameter(Mandatory = $true)]$Site
    )

    $rootApplication = $Site.Applications['/']
    $rootVirtualDirectory = $null
    if ($null -ne $rootApplication) { $rootVirtualDirectory = $rootApplication.VirtualDirectories['/'] }
    $ftpServer = Get-MpwFtpSiteElement -Site $Site
    $security = $ftpServer.GetChildElement('security')
    $authentication = $security.GetChildElement('authentication')
    $ssl = $security.GetChildElement('ssl')
    $authorization = Get-MpwFtpAuthorizationSection -Manager $Manager -SiteName ([string]$Site.Name)
    $siteFirewall = $ftpServer.GetChildElement('firewallSupport')

    $authorizationCollection = $authorization.GetCollection()
    $rules = @($authorizationCollection | ForEach-Object {
        $rawAccessType = [string]$_['accessType']
        $rawPermissions = [string]$_['permissions']
        [ordered]@{
            accessType = ConvertTo-MpwFtpAuthorizationAccessTypeName -Value $rawAccessType
            users = [string]$_['users']
            roles = [string]$_['roles']
            permissions = ConvertTo-MpwFtpAuthorizationPermissionsName -Value $rawPermissions
            rawAccessType = $rawAccessType
            rawPermissions = $rawPermissions
        }
    })
    $bindings = @($Site.Bindings | ForEach-Object {
        [ordered]@{
            protocol = [string]$_.Protocol
            bindingInformation = [string]$_.BindingInformation
            port = Get-MpwBindingPort -BindingInformation ([string]$_.BindingInformation)
        }
    })

    return [ordered]@{
        name = [string]$Site.Name
        id = [long]$Site.Id
        state = Get-MpwFtpSiteRuntimeState -Site $Site
        serverAutoStart = Get-MpwFtpSiteAutoStart -Site $Site
        physicalPath = if ($null -ne $rootVirtualDirectory) { [Environment]::ExpandEnvironmentVariables([string]$rootVirtualDirectory.PhysicalPath) } else { $null }
        bindings = $bindings
        authentication = [ordered]@{
            anonymousEnabled = [bool]$authentication.GetChildElement('anonymousAuthentication')['enabled']
            basicEnabled = [bool]$authentication.GetChildElement('basicAuthentication')['enabled']
        }
        authorization = $rules
        ssl = [ordered]@{
            controlChannelPolicy = ConvertTo-MpwFtpSslPolicyName -Value ([string]$ssl['controlChannelPolicy']) -Channel control
            dataChannelPolicy = ConvertTo-MpwFtpSslPolicyName -Value ([string]$ssl['dataChannelPolicy']) -Channel data
            rawControlChannelPolicy = [string]$ssl['controlChannelPolicy']
            rawDataChannelPolicy = [string]$ssl['dataChannelPolicy']
        }
        externalIp4Address = [string]$siteFirewall['externalIp4Address']
    }
}

function Get-MpwFtpSites {
    param([Parameter(Mandatory = $true)]$Manager)

    $sites = @()
    foreach ($site in $Manager.Sites) {
        $ftpBindings = @($site.Bindings | Where-Object { $_.Protocol -eq 'ftp' })
        if ($ftpBindings.Count -gt 0) {
            try {
                $sites += Get-MpwFtpSiteModel -Manager $Manager -Site $site
            }
            catch {
                # Discovery must not fail just because one pre-existing FTP
                # site has incomplete child configuration. Identity, path and
                # bindings are sufficient to present a safe adoption choice.
                $identity = Get-MpwIisSiteIdentityModel -Site $site
                $identity['authentication'] = [ordered]@{ anonymousEnabled = $null; basicEnabled = $null }
                $identity['authorization'] = @()
                $identity['ssl'] = [ordered]@{ controlChannelPolicy = $null; dataChannelPolicy = $null }
                $identity['externalIp4Address'] = $null
                $identity['inspectionErrorCode'] = 'IIS_SITE_DETAIL_UNAVAILABLE'
                $sites += $identity
            }
        }
    }
    return @($sites)
}

function Get-MpwIisSiteById {
    param(
        [Parameter(Mandatory = $true)]$Manager,
        [Parameter(Mandatory = $true)][long]$SiteId
    )

    if ($SiteId -le 0) { return $null }
    foreach ($candidate in $Manager.Sites) {
        if ([long]$candidate.Id -eq $SiteId) { return $candidate }
    }
    return $null
}

function Find-MpwPortSites {
    param(
        [Parameter(Mandatory = $true)]$Manager,
        [Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$Port,
        [AllowNull()][string]$ExcludeSiteName = $null
    )

    $matches = @()
    foreach ($site in $Manager.Sites) {
        if (-not [string]::IsNullOrWhiteSpace($ExcludeSiteName) -and $site.Name -eq $ExcludeSiteName) { continue }
        foreach ($binding in $site.Bindings | Where-Object { $_.Protocol -eq 'ftp' }) {
            if ((Get-MpwBindingPort -BindingInformation ([string]$binding.BindingInformation)) -eq $Port) {
                # Port ownership preflight needs only stable identity fields.
                # Reading authentication/authorization here caused malformed
                # or partially configured IIS sites to abort discovery before
                # the user could see and adopt the actual port owner.
                $matches += Get-MpwIisSiteIdentityModel -Site $site
                break
            }
        }
    }
    return @($matches)
}



function Get-MpwSiteSnapshot {
    param(
        [Parameter(Mandatory = $true)]$Manager,
        [Parameter(Mandatory = $true)]$Site
    )
    return Get-MpwFtpSiteModel -Manager $Manager -Site $Site
}

function Test-MpwSiteManagedByAccount {
    param(
        [Parameter(Mandatory = $true)]$Site,
        [Parameter(Mandatory = $true)][string]$SiteName,
        [Parameter(Mandatory = $true)][string]$Username,
        [Parameter(Mandatory = $true)][long]$ManagedSiteId
    )

    if ($ManagedSiteId -gt 0 -and [long]$Site.Id -ne $ManagedSiteId) { return $false }
    if ($ManagedSiteId -le 0 -and [string]$Site.Name -ne $SiteName) { return $false }
    # Site ID is the persisted identity. A user may rename a site in IIS, so
    # name drift alone must be repairable instead of turning the managed site
    # into an unrelated/adoptable resource.
    if (@($Site.Bindings | Where-Object { $_.Protocol -eq 'ftp' }).Count -eq 0) { return $false }
    $account = Get-MpwLocalAccountStatus -Username $Username
    if ($account.isManaged -ne $true) { return $false }
    return $true
}


function Get-MpwGlobalPassivePorts {
    param([Parameter(Mandatory = $true)]$Manager)

    $section = $Manager.GetApplicationHostConfiguration().GetSection('system.ftpServer/firewallSupport')
    return [ordered]@{
        start = [int]$section['lowDataChannelPort']
        end = [int]$section['highDataChannelPort']
    }
}


function Get-MpwServiceStartType {
    param([Parameter(Mandatory = $true)][string]$Name)

    try {
        $startValue = [int](Get-ItemPropertyValue -LiteralPath "HKLM:\SYSTEM\CurrentControlSet\Services\$Name" -Name Start -ErrorAction Stop)
        $startType = switch ($startValue) { 2 { 'Auto' } 3 { 'Manual' } 4 { 'Disabled' } default { 'unknown' } }
        return $startType
    }
    catch { return 'unknown' }
}

function Get-MpwServiceModel {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [bool]$IncludeDependencies = $false
    )

    try {
        $controller = Get-Service -Name $Name -ErrorAction SilentlyContinue
        if ($null -eq $controller) {
            return [ordered]@{ exists = $false; name = $Name; state = $null; status = 'notFound'; startMode = $null; startType = 'unknown'; running = $false; pending = $false; processId = $null; startName = ''; serviceType = ''; dependencies = @() }
        }
        $cimService = $null
        try { $cimService = Get-CimInstance Win32_Service -Filter "Name='$($Name.Replace("'", "''"))'" -ErrorAction Stop } catch {}
        $startType = Get-MpwServiceStartType -Name $Name
        $state = [string]$controller.Status
        $pending = $state -match 'Pending$'
        $dependencies = @()
        if ($IncludeDependencies) {
            $dependencies = @($controller.ServicesDependedOn | ForEach-Object { Get-MpwServiceModel -Name ([string]$_.Name) -IncludeDependencies $false })
        }
        return [ordered]@{
            exists = $true
            name = [string]$controller.Name
            displayName = [string]$controller.DisplayName
            state = $state
            status = $state
            startMode = $startType
            startType = $startType
            running = $controller.Status -eq [ServiceProcess.ServiceControllerStatus]::Running
            pending = $pending
            processId = if ($null -ne $cimService) { [int]$cimService.ProcessId } else { $null }
            startName = if ($null -ne $cimService) { [string]$cimService.StartName } else { '' }
            serviceType = if ($null -ne $cimService) { [string]$cimService.ServiceType } else { '' }
            dependencies = $dependencies
        }
    }
    catch {
        return [ordered]@{ exists = $null; name = $Name; state = 'unknown'; status = 'unknown'; startMode = $null; startType = 'unknown'; running = $null; pending = $null; processId = $null; startName = ''; serviceType = ''; dependencies = @(); errorCode = 'IIS_SERVICE_STATUS_FAILED' }
    }
}

function Get-MpwFtpServiceStatus {
    return Get-MpwFtpServiceMutationSnapshot
}

function Get-MpwServiceDependencySnapshotTree {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][Collections.Generic.HashSet[string]]$Visited
    )

    if (-not $Visited.Add($Name)) { return $null }
    $controller = Get-Service -Name $Name -ErrorAction SilentlyContinue
    if ($null -eq $controller) {
        return [ordered]@{
            exists = $false
            name = $Name
            state = $null
            status = 'notFound'
            startMode = $null
            startType = 'unknown'
            running = $false
            pending = $false
            dependencies = @()
        }
    }
    $state = [string]$controller.Status
    $children = [Collections.Generic.List[object]]::new()
    if ($null -ne $controller) {
        foreach ($dependency in @($controller.ServicesDependedOn)) {
            $child = Get-MpwServiceDependencySnapshotTree -Name ([string]$dependency.Name) -Visited $Visited
            if ($null -ne $child) { [void]$children.Add($child) }
        }
    }
    $startType = Get-MpwServiceStartType -Name $Name
    return [ordered]@{
        exists = $true
        name = [string]$controller.Name
        displayName = [string]$controller.DisplayName
        state = $state
        status = $state
        startMode = $startType
        startType = $startType
        running = $controller.Status -eq [ServiceProcess.ServiceControllerStatus]::Running
        pending = $state -match 'Pending$'
        processId = $null
        startName = ''
        serviceType = ''
        dependencies = @($children)
    }
}

function Get-MpwFtpServiceMutationSnapshot {
    $root = Get-MpwServiceModel -Name 'FTPSVC' -IncludeDependencies $false
    if ($root.exists -ne $true) { return $root }

    $visited = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    [void]$visited.Add('FTPSVC')
    $children = [Collections.Generic.List[object]]::new()
    $controller = Get-Service -Name 'FTPSVC' -ErrorAction SilentlyContinue
    if ($null -ne $controller) {
        foreach ($dependency in @($controller.ServicesDependedOn)) {
            $child = Get-MpwServiceDependencySnapshotTree -Name ([string]$dependency.Name) -Visited $visited
            if ($null -ne $child) { [void]$children.Add($child) }
        }
    }
    $root.dependencies = @($children)
    return $root
}



function Get-MpwServiceFailureDiagnostics {
    param([Parameter(Mandatory = $true)][string[]]$ServiceNames)

    $events = @()
    try {
        $escapedNames = @($ServiceNames | Where-Object { $_ } | ForEach-Object { [Regex]::Escape($_) })
        $pattern = if ($escapedNames.Count -gt 0) { '(?i)' + ($escapedNames -join '|') } else { '(?i)FTP|IIS|WAS' }
        $events = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; StartTime = [DateTime]::Now.AddMinutes(-10) } -ErrorAction Stop |
            Where-Object { [string]$_.ProviderName -match '(?i)Service Control Manager|IIS|FTP|WAS' -or [string]$_.Message -match $pattern } |
            Select-Object -First 12 |
            ForEach-Object {
                $message = ([string]$_.Message) -replace '[\r\n]+', ' '
                [ordered]@{
                    timeCreated = if ($null -ne $_.TimeCreated) { $_.TimeCreated.ToString('o') } else { '' }
                    provider = [string]$_.ProviderName
                    id = [int]$_.Id
                    level = [string]$_.LevelDisplayName
                    message = $message.Substring(0, [Math]::Min(1200, $message.Length))
                }
            })
    }
    catch {}
    return [ordered]@{
        services = @($ServiceNames | ForEach-Object { Get-MpwServiceModel -Name $_ -IncludeDependencies $false })
        events = $events
    }
}

function Wait-MpwServiceStableState {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [int]$TimeoutMilliseconds = $script:MpwServicePendingTimeoutMilliseconds
    )

    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
    do {
        $controller = Get-Service -Name $Name -ErrorAction SilentlyContinue
        if ($null -eq $controller) { return $null }
        $state = [string]$controller.Status
        if ($state -notmatch 'Pending$') { return $controller }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)

    Throw-MpwFailure -Code 'IIS_FTP_SERVICE_PENDING_TIMEOUT' -Message "The Windows service $Name did not leave its pending state." -Command 'Get-Service/WaitForStatus' -Details ([ordered]@{
        serviceName = $Name
        timeoutMilliseconds = $TimeoutMilliseconds
        diagnostics = Get-MpwServiceFailureDiagnostics -ServiceNames @($Name, 'FTPSVC')
    })
}




function ConvertTo-MpwServiceStartupType {
    param([AllowNull()][string]$StartType)

    if ([string]::IsNullOrWhiteSpace($StartType)) { return $null }
    switch ($StartType.Trim().ToLowerInvariant()) {
        'auto' { return 'Automatic' }
        'automatic' { return 'Automatic' }
        'manual' { return 'Manual' }
        'disabled' { return 'Disabled' }
        default { return $null }
    }
}

function Get-MpwFtpServiceRollbackDecision {
    param(
        [AllowNull()]$Snapshot,
        [AllowNull()]$CurrentStatus,
        [object[]]$OtherStartedSites = @(),
        [bool]$SiteInspectionSucceeded = $true
    )

    $originalExists = [bool](Get-MpwInputValue -InputObject $Snapshot -Name 'exists' -DefaultValue $false)
    $originalRunningValue = Get-MpwInputValue -InputObject $Snapshot -Name 'running' -DefaultValue $null
    $currentRunningValue = Get-MpwInputValue -InputObject $CurrentStatus -Name 'running' -DefaultValue $null
    $startupType = ConvertTo-MpwServiceStartupType -StartType ([string](Get-MpwInputValue -InputObject $Snapshot -Name 'startType' -DefaultValue ''))
    $otherSites = @($OtherStartedSites)

    $restoreRunningState = 'not_required'
    $reason = 'SERVICE_STATE_ALREADY_MATCHES_SNAPSHOT'
    if (-not $originalExists -or $null -eq $originalRunningValue -or $null -eq $currentRunningValue) {
        $restoreRunningState = 'skip'
        $reason = 'SERVICE_SNAPSHOT_INCOMPLETE'
    }
    elseif ([bool]$originalRunningValue -and -not [bool]$currentRunningValue) {
        $restoreRunningState = 'start'
        $reason = 'SERVICE_WAS_RUNNING_BEFORE_OPERATION'
    }
    elseif (-not [bool]$originalRunningValue -and [bool]$currentRunningValue) {
        if (-not $SiteInspectionSucceeded) {
            $restoreRunningState = 'skip'
            $reason = 'FTP_SITE_INSPECTION_FAILED'
        }
        elseif ($otherSites.Count -gt 0) {
            $restoreRunningState = 'skip'
            $reason = 'OTHER_FTP_SITES_RUNNING'
        }
        else {
            $restoreRunningState = 'stop'
            $reason = 'SERVICE_WAS_STOPPED_BEFORE_OPERATION'
        }
    }

    return [ordered]@{
        startupType = $startupType
        startupTypeRestorable = $null -ne $startupType
        runningStateAction = $restoreRunningState
        runningStateReason = $reason
        otherStartedSites = $otherSites
    }
}


function Get-MpwExcludedTcpPortRanges {
    $ranges = @()
    try {
        $lines = @(& netsh.exe interface ipv4 show excludedportrange protocol=tcp 2>$null)
        foreach ($line in $lines) {
            if ([string]$line -match '^\s*(\d+)\s+(\d+)') {
                $start = [int]$Matches[1]
                $end = [int]$Matches[2]
                if ($start -ge 1 -and $end -ge $start -and $end -le 65535) {
                    $ranges += [ordered]@{ start = $start; end = $end; value = "$start-$end" }
                }
            }
        }
    }
    catch {}
    return @($ranges)
}

function Get-MpwReservedTcpPort {
    param([Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$Port)

    $range = Get-MpwExcludedTcpPortRanges | Where-Object { $Port -ge [int]$_.start -and $Port -le [int]$_.end } | Select-Object -First 1
    return [ordered]@{
        reserved = $null -ne $range
        range = if ($null -ne $range) { [string]$range.value } else { '' }
    }
}

function Get-MpwListeningTcpPorts {
    try {
        return @(Get-NetTCPConnection -State Listen -ErrorAction Stop | ForEach-Object { [int]$_.LocalPort } | Sort-Object -Unique)
    }
    catch { return @() }
}

function Get-MpwAvailableControlPorts {
    param(
        [Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$PreferredPort,
        [Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$PassiveStart,
        [Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$PassiveEnd,
        [ValidateRange(1, 20)][int]$Count = 5
    )

    $listeners = @(Get-MpwListeningTcpPorts)
    $reserved = @(Get-MpwExcludedTcpPortRanges)
    $iisBoundPorts = @()
    $portManager = $null
    try {
        $portManager = Open-MpwServerManager
        $iisBoundPorts = @($portManager.Sites | ForEach-Object { $_.Bindings } | Where-Object { $_.Protocol -eq 'ftp' } | ForEach-Object {
            Get-MpwBindingPort -BindingInformation ([string]$_.BindingInformation)
        } | Where-Object { $null -ne $_ } | Sort-Object -Unique)
    }
    catch {
        # Ordinary inspection may not be allowed to read IIS configuration.
        # Elevated Preflight repeats this check and never treats an unknown
        # owner as authorization to modify an external site.
        $iisBoundPorts = @()
    }
    finally {
        if ($null -ne $portManager) { $portManager.Dispose() }
    }
    $results = [Collections.Generic.List[int]]::new()
    $isAvailable = {
        param([int]$Candidate)
        if ($Candidate -ge $PassiveStart -and $Candidate -le $PassiveEnd) { return $false }
        if ($listeners -contains $Candidate) { return $false }
        if ($iisBoundPorts -contains $Candidate) { return $false }
        if (@($reserved | Where-Object { $Candidate -ge [int]$_.start -and $Candidate -le [int]$_.end }).Count -gt 0) { return $false }
        return $true
    }
    if (& $isAvailable $PreferredPort) { [void]$results.Add($PreferredPort) }
    for ($candidate = 1024; $candidate -le 65535 -and $results.Count -lt $Count; $candidate++) {
        if ($results.Contains($candidate)) { continue }
        if (& $isAvailable $candidate) { [void]$results.Add($candidate) }
    }
    return @($results)
}

function Get-MpwTcpListenerConnections {
    param([Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$Port)

    try {
        return [ordered]@{
            detection = 'available'
            source = 'Get-NetTCPConnection'
            connections = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop)
            errorCode = ''
        }
    }
    catch {
        # Get-NetTCPConnection can return Access Denied for ordinary desktop
        # processes even though TCP ownership is public system information.
        # netstat does not require elevation and prevents that permission limit
        # from being misreported as an FTP listener that disappeared.
        try {
            $connections = @()
            $netstatPath = Join-Path $env:windir 'System32\netstat.exe'
            foreach ($line in @(& $netstatPath -ano -p TCP 2>$null)) {
                if ([string]$line -notmatch '^\s*TCP\s+(\S+):(\d+)\s+\S+\s+(\S+)\s+(\d+)\s*$') { continue }
                if ([int]$Matches[2] -ne $Port -or [string]$Matches[3] -ne 'LISTENING') { continue }
                $connections += [pscustomobject]@{
                    LocalAddress = ([string]$Matches[1]).Trim('[', ']')
                    LocalPort = $Port
                    OwningProcess = [int]$Matches[4]
                }
            }
            return [ordered]@{
                detection = 'available'
                source = 'netstat'
                connections = @($connections)
                errorCode = ''
            }
        }
        catch {
            return [ordered]@{
                detection = 'unknown'
                source = 'unavailable'
                connections = @()
                errorCode = 'TCP_LISTENER_STATUS_FAILED'
            }
        }
    }
}

function Get-MpwPortStatus {
    param(
        [Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$Port,
        [Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$PassiveStart,
        [Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$PassiveEnd,
        [AllowNull()]$FtpServiceStatus = $null,
        [switch]$IncludeAvailablePorts
    )

    $listeners = @()
    $connectionStatus = Get-MpwTcpListenerConnections -Port $Port
    $connections = @($connectionStatus.connections)
    # Callers that already collected the FTPSVC snapshot can pass it here.
    # Re-querying Win32_Service is noticeably expensive on partially initialized
    # Windows installations and used to multiply the final verification time.
    $ftpService = if ($PSBoundParameters.ContainsKey('FtpServiceStatus') -and $null -ne $FtpServiceStatus) {
        $FtpServiceStatus
    }
    else { Get-MpwFtpServiceStatus }
    foreach ($connection in $connections) {
        $pidValue = [int]$connection.OwningProcess
        $processName = $null
        try { $processName = (Get-Process -Id $pidValue -ErrorAction Stop).ProcessName } catch {}
        $services = @()
        try {
            $services = @(Get-CimInstance Win32_Service -Filter "ProcessId=$pidValue" -ErrorAction Stop | Select-Object Name, DisplayName, State)
        }
        catch {}
        $isFtpSvc = $null
        if ($ftpService.exists -eq $true -and $null -ne $ftpService.processId) {
            $isFtpSvc = [int]$ftpService.processId -eq $pidValue
        }
        if ($services.Count -gt 0) {
            $isFtpSvc = @($services | Where-Object { $_.Name -eq 'FTPSVC' }).Count -gt 0
        }
        elseif ($null -eq $isFtpSvc -and -not [string]::IsNullOrWhiteSpace([string]$processName) -and [string]$processName -ne 'svchost') {
            $isFtpSvc = $false
        }
        $listeners += [ordered]@{
            localAddress = [string]$connection.LocalAddress
            localPort = [int]$connection.LocalPort
            pid = $pidValue
            processName = [string]$processName
            services = @($services | ForEach-Object { [ordered]@{ name = [string]$_.Name; displayName = [string]$_.DisplayName; state = [string]$_.State } })
            isMicrosoftFtpService = $isFtpSvc
        }
    }
    $reservation = Get-MpwReservedTcpPort -Port $Port
    $listenerDetectionAvailable = [string]$connectionStatus.detection -eq 'available'
    $usedByOtherProcess = if (-not $listenerDetectionAvailable) { $null } elseif (@($listeners | Where-Object { $_.isMicrosoftFtpService -eq $false }).Count -gt 0) { $true } elseif (@($listeners | Where-Object { $null -eq $_.isMicrosoftFtpService }).Count -gt 0) { $null } else { $false }
    # Enumerating every TCP listener, every IIS FTP binding and every excluded
    # Windows port range is a conflict-resolution operation, not a health check.
    # Keep the healthy listener hot path targeted to the configured port.
    $shouldSuggestPorts = $IncludeAvailablePorts.IsPresent -or [bool]$reservation.reserved -or $usedByOtherProcess -eq $true
    $availablePorts = @()
    if ($shouldSuggestPorts) {
        $availablePorts = @(Get-MpwAvailableControlPorts -PreferredPort 21 -PassiveStart $PassiveStart -PassiveEnd $PassiveEnd -Count 5)
    }
    return [ordered]@{
        configuredPort = $Port
        detection = [string]$connectionStatus.detection
        detectionSource = [string]$connectionStatus.source
        listening = if ($listenerDetectionAvailable) { $listeners.Count -gt 0 } else { $null }
        listeners = @($listeners)
        usedByOtherProcess = $usedByOtherProcess
        pid = if ($listeners.Count -gt 0) { [int]$listeners[0].pid } else { $null }
        processName = if ($listeners.Count -gt 0) { [string]$listeners[0].processName } else { '' }
        ownedByMicrosoftFtp = if ($listeners.Count -gt 0) { $listeners[0].isMicrosoftFtpService } elseif ($listenerDetectionAvailable) { $false } else { $null }
        conflict = $usedByOtherProcess
        reserved = [bool]$reservation.reserved
        reservedRange = [string]$reservation.range
        iisSiteName = ''
        iisSiteNames = @()
        ownedByManagedSite = $null
        adoptable = $null
        canChangePort = $true
        availablePorts = @($availablePorts)
        recommendation = if (@($availablePorts).Count -gt 0) { "Use available control port $($availablePorts[0]) after confirmation." } elseif ($shouldSuggestPorts) { 'No available control port was found.' } else { '' }
    }
}

function Get-MpwFirewallRuleModel {
    param(
        [Parameter(Mandatory = $true)][string]$InternalName,
        [Parameter(Mandatory = $true)][string]$DisplayName,
        [string[]]$LegacyDisplayNames = @()
    )

    try {
        $rule = Get-NetFirewallRule -Name $InternalName -ErrorAction SilentlyContinue
        if ($null -eq $rule) {
            $rule = Get-NetFirewallRule -DisplayName $DisplayName -ErrorAction SilentlyContinue | Select-Object -First 1
        }
        if ($null -eq $rule) {
            foreach ($legacyDisplayName in $LegacyDisplayNames) {
                $rule = Get-NetFirewallRule -DisplayName $legacyDisplayName -ErrorAction SilentlyContinue | Select-Object -First 1
                if ($null -ne $rule) { break }
            }
        }
        if ($null -eq $rule) {
            return [ordered]@{ exists = $false; internalName = $InternalName; displayName = $DisplayName; enabled = $false; direction = 'unknown'; action = 'unknown'; profile = 'unknown'; protocol = 'unknown'; localPort = ''; localAddress = 'unknown'; remoteAddress = 'unknown'; policyStoreSourceType = 'unknown' }
        }
        $port = $rule | Get-NetFirewallPortFilter -ErrorAction Stop
        $address = $rule | Get-NetFirewallAddressFilter -ErrorAction Stop
        return [ordered]@{
            exists = $true
            internalName = [string]$rule.Name
            displayName = [string]$rule.DisplayName
            enabled = [string]$rule.Enabled -eq 'True'
            direction = [string]$rule.Direction
            action = [string]$rule.Action
            profile = [string]$rule.Profile
            protocol = [string]$port.Protocol
            localPort = [string]$port.LocalPort
            localAddress = [string]$address.LocalAddress
            remoteAddress = [string]$address.RemoteAddress
            policyStoreSourceType = [string]$rule.PolicyStoreSourceType
        }
    }
    catch {
        return [ordered]@{ exists = $null; internalName = $InternalName; displayName = $DisplayName; enabled = $null; direction = 'unknown'; action = 'unknown'; profile = 'unknown'; protocol = 'unknown'; localPort = ''; localAddress = 'unknown'; remoteAddress = 'unknown'; policyStoreSourceType = 'unknown'; errorCode = 'FIREWALL_STATUS_FAILED' }
    }
}

function Get-MpwFirewallRuleSelection {
    param(
        [Parameter(Mandatory = $true)][ValidateSet('control', 'passive')][string]$Kind,
        [Parameter(Mandatory = $true)][string]$DisplayName
    )

    $internalName = if ($Kind -eq 'control') { $script:MpwControlFirewallInternalName } else { $script:MpwPassiveFirewallInternalName }
    $legacyDisplayName = if ($Kind -eq 'control') { 'MPW IIS FTP Control' } else { 'MPW IIS FTP Passive' }
    $rule = Get-NetFirewallRule -Name $internalName -ErrorAction SilentlyContinue
    if ($null -ne $rule) {
        return [pscustomobject][ordered]@{ rule = $rule; internalName = $internalName; managed = $true }
    }

    $matches = [Collections.Generic.List[object]]::new()
    foreach ($candidateDisplayName in @($DisplayName, $legacyDisplayName) | Select-Object -Unique) {
        foreach ($candidate in @(Get-NetFirewallRule -DisplayName $candidateDisplayName -ErrorAction SilentlyContinue)) {
            if (@($matches | Where-Object { [string]$_.Name -eq [string]$candidate.Name }).Count -eq 0) {
                [void]$matches.Add($candidate)
            }
        }
    }
    if ($matches.Count -gt 1) {
        Throw-MpwFailure -Code 'FIREWALL_RULE_POLICY_BLOCKED' -Message 'Multiple legacy FTP firewall rules share a managed display name and cannot be changed automatically.' -Details ([ordered]@{
            source = 'ambiguousLegacyFirewallRules'
            kind = $Kind
            rules = @($matches | ForEach-Object { [ordered]@{ internalName = [string]$_.Name; displayName = [string]$_.DisplayName; policyStoreSourceType = [string]$_.PolicyStoreSourceType } })
            recommendation = 'Review the duplicate local or policy firewall rules in Windows Defender Firewall with Advanced Security.'
        })
    }
    return [pscustomobject][ordered]@{
        rule = if ($matches.Count -eq 1) { $matches[0] } else { $null }
        internalName = $internalName
        managed = $false
    }
}

function Get-MpwFirewallRuleSnapshot {
    param([Parameter(Mandatory = $true)]$Rule)

    $port = $Rule | Get-NetFirewallPortFilter -ErrorAction Stop
    $address = $Rule | Get-NetFirewallAddressFilter -ErrorAction Stop
    return [ordered]@{
        internalName = [string]$Rule.Name
        displayName = [string]$Rule.DisplayName
        enabled = [string]$Rule.Enabled -eq 'True'
        direction = [string]$Rule.Direction
        action = [string]$Rule.Action
        profile = [string]$Rule.Profile
        protocol = [string]$port.Protocol
        localPort = @($port.LocalPort | ForEach-Object { [string]$_ })
        remotePort = @($port.RemotePort | ForEach-Object { [string]$_ })
        localAddress = @($address.LocalAddress | ForEach-Object { [string]$_ })
        remoteAddress = @($address.RemoteAddress | ForEach-Object { [string]$_ })
        policyStoreSourceType = [string]$Rule.PolicyStoreSourceType
    }
}








function Get-MpwRequiredWindowsFeatureNames {
    return @('IIS-FTPServer', 'IIS-FTPSvc', 'IIS-FTPExtensibility', 'IIS-ManagementScriptingTools')
}

function Resolve-MpwWindowsRestartPendingStatus {
    param(
        [string[]]$SystemReasons = @(),
        [string[]]$PendingFileRenameEntries = @()
    )

    $normalizedReasons = @($SystemReasons | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) } | Select-Object -Unique)
    $renameEntries = @($PendingFileRenameEntries | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
    $iisRelatedRenameEntries = @($renameEntries | Where-Object { [string]$_ -match '(?i)\\inetsrv\\|\\InetStp\\|ftpsvc|iisftp|Microsoft\.Web\.Administration' })
    $systemReasonList = [Collections.Generic.List[string]]::new()
    foreach ($reason in $normalizedReasons) { [void]$systemReasonList.Add([string]$reason) }
    if ($renameEntries.Count -gt 0) { [void]$systemReasonList.Add('PendingFileRenameOperations') }
    return [ordered]@{
        # Generic Windows restart markers are advisory only. They are often
        # created by unrelated applications and must not block a healthy IIS
        # FTP runtime. Required IIS restarts are derived from feature Pending
        # states or the feature enable command's explicit restart result instead.
        pending = $false
        iisRequired = $false
        reasons = @()
        systemPending = [bool]($normalizedReasons.Count -gt 0 -or $renameEntries.Count -gt 0)
        systemReasons = @($systemReasonList | Select-Object -Unique)
        pendingFileRenameCount = $renameEntries.Count
        iisRelatedPendingFileRenameCount = $iisRelatedRenameEntries.Count
    }
}

function Get-MpwWindowsRestartPendingStatus {
    $reasons = [Collections.Generic.List[string]]::new()
    $paths = @(
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending',
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired'
    )
    foreach ($path in $paths) {
        try { if (Test-Path -LiteralPath $path) { [void]$reasons.Add($path) } } catch {}
    }
    $pendingRenameEntries = @()
    try { $pendingRenameEntries = @(Get-ItemPropertyValue -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager' -Name PendingFileRenameOperations -ErrorAction Stop) }
    catch {}
    return Resolve-MpwWindowsRestartPendingStatus -SystemReasons @($reasons) -PendingFileRenameEntries $pendingRenameEntries
}

function Get-MpwFileReadiness {
    param([Parameter(Mandatory = $true)][string]$Path)

    $stream = $null
    try {
        $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
        return [ordered]@{ path = $Path; exists = $true; readable = $true; accessDenied = $false; errorCode = '' }
    }
    catch [System.UnauthorizedAccessException] {
        # An access-denied result proves that the protected IIS resource is
        # present; ordinary status checks must not reinterpret it as missing.
        return [ordered]@{ path = $Path; exists = $true; readable = $false; accessDenied = $true; errorCode = 'ADMIN_REQUIRED' }
    }
    catch [System.IO.FileNotFoundException] {
        return [ordered]@{ path = $Path; exists = $false; readable = $false; accessDenied = $false; errorCode = 'FILE_NOT_FOUND' }
    }
    catch [System.IO.DirectoryNotFoundException] {
        return [ordered]@{ path = $Path; exists = $false; readable = $false; accessDenied = $false; errorCode = 'DIRECTORY_NOT_FOUND' }
    }
    catch {
        $diagnostic = Get-MpwExceptionDiagnosticDetails -ErrorRecord $_
        return [ordered]@{ path = $Path; exists = $true; readable = $false; accessDenied = $false; errorCode = 'FILE_READ_FAILED'; diagnostics = $diagnostic }
    }
    finally {
        if ($null -ne $stream) { $stream.Dispose() }
    }
}

function Get-MpwWindowsFeaturesStatus {
    $names = @(Get-MpwRequiredWindowsFeatureNames)
    $isAdmin = Test-MpwAdministrator
    $registryHints = @{}
    try {
        $components = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\InetStp\Components' -ErrorAction Stop
        $registryHints['IIS-FTPSvc'] = [bool]($components.FTPSvc -eq 1)
        $registryHints['IIS-FTPExtensibility'] = [bool]($components.FTPExtensibility -eq 1)
        $registryHints['IIS-ManagementScriptingTools'] = [bool](Test-Path -LiteralPath (Join-Path $env:windir 'System32\WindowsPowerShell\v1.0\Modules\WebAdministration\WebAdministration.psd1'))
        $registryHints['IIS-FTPServer'] = [bool]($registryHints['IIS-FTPSvc'] -or $registryHints['IIS-FTPExtensibility'])
    }
    catch {}

    $features = @()
    foreach ($name in $names) {
        if (-not $isAdmin) {
            $features += [ordered]@{
                featureName = $name
                state = 'unknown'
                installedHint = if ($registryHints.ContainsKey($name)) { [bool]$registryHints[$name] } else { $null }
                requiresAdmin = $true
            }
            continue
        }
        try {
            $feature = Get-WindowsOptionalFeature -Online -FeatureName $name -ErrorAction Stop
            $features += [ordered]@{
                featureName = [string]$feature.FeatureName
                state = [string]$feature.State
                installedHint = [string]$feature.State -eq 'Enabled'
                requiresAdmin = $false
            }
        }
        catch {
            $diagnostic = Get-MpwExceptionDiagnosticDetails -ErrorRecord $_
            $featureUnavailable = [string]$diagnostic.hresult -eq '0x800F080C' -or [string]$diagnostic.technicalMessage -match '(?i)unknown feature|feature name.*not recognized|功能名称.*未知'
            $features += [ordered]@{
                featureName = $name
                state = if ($featureUnavailable) { 'Unavailable' } else { 'unknown' }
                installedHint = $null
                requiresAdmin = -not $featureUnavailable
                errorCode = if ($featureUnavailable) { 'IIS_FTP_FEATURE_UNAVAILABLE' } else { 'WINDOWS_FEATURE_STATUS_FAILED' }
                technicalMessage = [string]$diagnostic.technicalMessage
                hresult = [string]$diagnostic.hresult
            }
        }
    }
    return @($features)
}


function Resolve-MpwIisInitializationState {
    param(
        [Parameter(Mandatory = $true)][object[]]$Features,
        [Parameter(Mandatory = $true)]$RestartPending,
        [Parameter(Mandatory = $true)][bool]$ManagementApiExists,
        [Parameter(Mandatory = $true)][bool]$ConfigurationExists,
        [Parameter(Mandatory = $true)]$Service
    )

    $featurePending = @($Features | Where-Object { [string]$_.state -match 'Pending$' }).Count -gt 0
    $featureMissing = @($Features | Where-Object {
        $state = [string]$_.state
        $state -notin @('Enabled', 'Unavailable', 'unknown') -and $state -notmatch 'Pending$'
    }).Count -gt 0
    $featureUnavailable = @($Features | Where-Object { [string]$_.state -eq 'Unavailable' }).Count -gt 0
    if ($featureUnavailable) { return 'blocked' }
    if ($featureMissing) { return 'features_missing' }
    $explicitIisRestart = [bool](Get-MpwInputValue -InputObject $RestartPending -Name 'iisRequired' -DefaultValue (Get-MpwInputValue -InputObject $RestartPending -Name 'pending' -DefaultValue $false))
    if ($featurePending -or $explicitIisRestart) { return 'restart_pending' }
    if (-not $ManagementApiExists -or -not $ConfigurationExists) { return 'config_not_ready' }
    if ($Service.exists -eq $false) { return 'service_missing' }
    $serviceStartName = [string](Get-MpwInputValue -InputObject $Service -Name 'startName' -DefaultValue '')
    if (-not [string]::IsNullOrWhiteSpace($serviceStartName) -and $serviceStartName -notmatch '^(?i:LocalSystem|NT AUTHORITY\\(?:LocalService|NetworkService|SYSTEM))$') { return 'blocked' }
    if ([string]$Service.startType -eq 'Disabled') { return 'service_disabled' }
    if ([bool](Get-MpwInputValue -InputObject $Service -Name 'pending' -DefaultValue $false)) { return 'service_pending' }
    if ($Service.running -ne $true) { return 'service_stopped' }
    return 'ready'
}

function Get-MpwIisInitializationReadiness {
    param(
        [AllowNull()]$Features = $null,
        [AllowNull()]$RestartPending = $null,
        [AllowNull()]$Service = $null
    )

    $features = if ($PSBoundParameters.ContainsKey('Features')) { @($Features) } else { @(Get-MpwWindowsFeaturesStatus) }
    $restartPending = if ($PSBoundParameters.ContainsKey('RestartPending') -and $null -ne $RestartPending) { $RestartPending } else { Get-MpwWindowsRestartPendingStatus }
    $managementDll = Join-Path $env:windir 'System32\inetsrv\Microsoft.Web.Administration.dll'
    $configurationPath = Join-Path $env:windir 'System32\inetsrv\config\applicationHost.config'
    $service = if ($PSBoundParameters.ContainsKey('Service') -and $null -ne $Service) { $Service } else { Get-MpwFtpServiceStatus }
    $managementApi = Get-MpwFileReadiness -Path $managementDll
    $configuration = Get-MpwFileReadiness -Path $configurationPath
    $managementApiExists = [bool]$managementApi.exists
    $configurationExists = [bool]$configuration.exists
    $state = Resolve-MpwIisInitializationState -Features $features -RestartPending $restartPending -ManagementApiExists $managementApiExists -ConfigurationExists $configurationExists -Service $service
    return [ordered]@{
        state = $state
        windowsFeatures = $features
        restartPending = $restartPending
        managementApi = $managementApi
        configuration = $configuration
        service = $service
        serviceDependencies = @(Get-MpwInputValue -InputObject $service -Name 'dependencies' -DefaultValue @())
    }
}


function Get-MpwNetworkAddressStatus {
    $addresses = @()
    $wirelessCjk = ([string][char]0x65E0) + ([string][char]0x7EBF)
    try {
        $items = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Where-Object {
            $_.AddressState -eq 'Preferred' -and
            $_.IPAddress -notlike '127.*' -and
            $_.IPAddress -notlike '169.254.*'
        })
        foreach ($item in $items) {
            $alias = [string]$item.InterfaceAlias
            $ip = [string]$item.IPAddress
            $kind = 'lan'
            if ($ip -eq '192.168.137.1') {
                $kind = 'hotspot'
            }
            elseif ($alias -match '(?i)WLAN|Wi-Fi|Wireless' -or $alias.Contains($wirelessCjk)) {
                $kind = 'wlan'
            }
            elseif ($alias -match '(?i)Docker|WSL|VMware|VirtualBox|vEthernet|Hyper-V|vgate') {
                $kind = 'excludedVirtual'
            }
            $addresses += [ordered]@{
                interfaceAlias = $alias
                interfaceIndex = [int]$item.InterfaceIndex
                address = $ip
                prefixLength = [int]$item.PrefixLength
                kind = $kind
                recommended = $kind -eq 'hotspot' -or $kind -eq 'wlan'
            }
        }
        return [ordered]@{
            detection = 'available'
            hotspot = @($addresses | Where-Object { $_.kind -eq 'hotspot' })
            wlan = @($addresses | Where-Object { $_.kind -eq 'wlan' })
            lan = @($addresses | Where-Object { $_.kind -eq 'lan' })
            excluded = @($addresses | Where-Object { $_.kind -eq 'excludedVirtual' })
        }
    }
    catch {
        return [ordered]@{ detection = 'unknown'; hotspot = @(); wlan = @(); lan = @(); excluded = @(); errorCode = 'NETWORK_ADDRESS_STATUS_FAILED' }
    }
}

function Test-MpwSiteStarted {
    param([Parameter(Mandatory = $true)]$Site)
    return (Get-MpwFtpSiteRuntimeState -Site $Site) -eq 'Started'
}

function Get-MpwWin32CodeFromHresult {
    param([AllowNull()][string]$Hresult)

    if ([string]::IsNullOrWhiteSpace($Hresult)) { return $null }
    try {
        $raw = $Hresult.Trim()
        $value = if ($raw.StartsWith('0x', [StringComparison]::OrdinalIgnoreCase)) {
            [Convert]::ToUInt32($raw.Substring(2), 16)
        }
        else { [Convert]::ToUInt32($raw, [Globalization.CultureInfo]::InvariantCulture) }
        return [int]($value -band 0xFFFF)
    }
    catch { return $null }
}

function Get-MpwIisFtpStartDiagnostics {
    param(
        [Parameter(Mandatory = $true)]$Site,
        [int]$ControlPort = 0
    )

    # Diagnostics run from failure handlers and therefore must never replace
    # the original start error with a secondary StrictMode property error.
    # Some Windows builds (and the isolated tests) expose only part of the
    # ServerManager site surface after a runtime-method exception.
    $siteName = [string](Get-MpwInputValue -InputObject $Site -Name 'Name' -DefaultValue '')
    $siteId = [long](Get-MpwInputValue -InputObject $Site -Name 'Id' -DefaultValue 0)
    if ($ControlPort -lt 1 -or $ControlPort -gt 65535) {
        $binding = $null
        try {
            $bindings = Get-MpwInputValue -InputObject $Site -Name 'Bindings' -DefaultValue @()
            $binding = $bindings | Where-Object { [string](Get-MpwInputValue -InputObject $_ -Name 'Protocol' -DefaultValue '') -eq 'ftp' } | Select-Object -First 1
        }
        catch {}
        $bindingInformation = if ($null -ne $binding) { [string](Get-MpwInputValue -InputObject $binding -Name 'BindingInformation' -DefaultValue '') } else { '' }
        $bindingPort = if (-not [string]::IsNullOrWhiteSpace($bindingInformation)) { Get-MpwBindingPort -BindingInformation $bindingInformation } else { $null }
        $ControlPort = if ($null -ne $bindingPort) { [int]$bindingPort } else { 21 }
    }

    $diagnosticErrors = [Collections.Generic.List[object]]::new()
    $manager = $null
    $identity = $null
    $model = $null
    $portSites = @()
    try {
        $manager = Open-MpwServerManager
        $resolved = if ($siteId -gt 0) { Get-MpwIisSiteById -Manager $manager -SiteId $siteId } else { $null }
        if ($null -eq $resolved -and -not [string]::IsNullOrWhiteSpace($siteName)) { $resolved = $manager.Sites[$siteName] }
        if ($null -ne $resolved) {
            $identity = Get-MpwIisSiteIdentityModel -Site $resolved
            try { $model = Get-MpwFtpSiteModel -Manager $manager -Site $resolved } catch {}
        }
        $portSites = @(Find-MpwPortSites -Manager $manager -Port $ControlPort)
    }
    catch {
        [void]$diagnosticErrors.Add([ordered]@{ source = 'iis'; message = [string]$_.Exception.Message })
    }
    finally {
        if ($null -ne $manager) {
            try { $manager.Dispose() }
            catch { [void]$diagnosticErrors.Add([ordered]@{ source = 'iisDispose'; message = [string]$_.Exception.Message }) }
        }
    }

    $appcmdOutput = @()
    $appcmdExitCode = $null
    try {
        $appcmd = Join-Path $env:SystemRoot 'System32\inetsrv\appcmd.exe'
        if (Test-Path -LiteralPath $appcmd -PathType Leaf) {
            $appcmdOutput = @(& $appcmd list site "/site.name:$siteName" 2>&1 | ForEach-Object { ([string]$_).Substring(0, [Math]::Min(1000, ([string]$_).Length)) })
            $appcmdExitCode = $LASTEXITCODE
        }
    }
    catch {
        $appcmdOutput = @('appcmd read-only site listing failed: ' + [string]$_.Exception.Message)
        [void]$diagnosticErrors.Add([ordered]@{ source = 'appcmd'; message = [string]$_.Exception.Message })
    }

    $events = @()
    try {
        $startTime = [DateTime]::Now.AddMinutes(-10)
        $events = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; StartTime = $startTime } -ErrorAction Stop |
            Where-Object { [string]$_.ProviderName -match '(?i)IIS|FTP|WAS' -or [string]$_.Message -match "(?i)FTPSVC|$([Regex]::Escape($siteName))" } |
            Select-Object -First 12 |
            ForEach-Object {
                $message = ([string]$_.Message) -replace '[\r\n]+', ' '
                [ordered]@{
                    timeCreated = if ($null -ne $_.TimeCreated) { $_.TimeCreated.ToString('o') } else { '' }
                    provider = [string]$_.ProviderName
                    id = [int]$_.Id
                    level = [string]$_.LevelDisplayName
                    message = $message.Substring(0, [Math]::Min(1200, $message.Length))
                }
            })
    }
    catch {
        [void]$diagnosticErrors.Add([ordered]@{ source = 'eventLog'; message = [string]$_.Exception.Message })
    }

    $physicalPath = if ($null -ne $identity) { [string](Get-MpwInputValue -InputObject $identity -Name 'physicalPath' -DefaultValue '') } else { '' }
    $authorizationRules = if ($null -ne $model) { @(Get-MpwInputValue -InputObject $model -Name 'authorization' -DefaultValue @()) } else { @() }
    $authorizationUsers = @($authorizationRules | Where-Object { [string](Get-MpwInputValue -InputObject $_ -Name 'accessType' -DefaultValue '') -eq 'Allow' } | ForEach-Object { [string](Get-MpwInputValue -InputObject $_ -Name 'users' -DefaultValue '') })
    $account = $null
    $acl = $null
    if ($authorizationUsers.Count -gt 0 -and -not [string]::IsNullOrWhiteSpace($authorizationUsers[0])) {
        try { $account = Get-MpwLocalAccountStatus -Username $authorizationUsers[0] }
        catch { [void]$diagnosticErrors.Add([ordered]@{ source = 'account'; message = [string]$_.Exception.Message }) }
    }
    if (-not [string]::IsNullOrWhiteSpace($physicalPath) -and $authorizationUsers.Count -gt 0) {
        try { $acl = Get-MpwDirectoryAclStatus -PhysicalPath $physicalPath -Username $authorizationUsers[0] }
        catch { [void]$diagnosticErrors.Add([ordered]@{ source = 'acl'; message = [string]$_.Exception.Message }) }
    }
    $serviceStatus = try { Get-MpwFtpServiceStatus } catch {
        [void]$diagnosticErrors.Add([ordered]@{ source = 'service'; message = [string]$_.Exception.Message })
        [ordered]@{ state = 'unknown'; errorCode = 'FTPSVC_STATUS_UNAVAILABLE' }
    }
    $portStatus = try { Get-MpwPortStatus -Port $ControlPort -PassiveStart 50000 -PassiveEnd 50100 } catch {
        [void]$diagnosticErrors.Add([ordered]@{ source = 'port'; message = [string]$_.Exception.Message })
        [ordered]@{ port = $ControlPort; listening = $null; errorCode = 'FTP_PORT_STATUS_UNAVAILABLE' }
    }
    $featureStatus = try { @(Get-MpwWindowsFeaturesStatus) } catch {
        [void]$diagnosticErrors.Add([ordered]@{ source = 'windowsFeatures'; message = [string]$_.Exception.Message })
        @()
    }
    return [ordered]@{
        collectedAt = [DateTimeOffset]::UtcNow.ToString('o')
        service = $serviceStatus
        site = $identity
        siteConfiguration = $model
        targetPort = $ControlPort
        port = $portStatus
        portSites = $portSites
        physicalPathExists = if ([string]::IsNullOrWhiteSpace($physicalPath)) { $false } else { [IO.Directory]::Exists($physicalPath) }
        account = $account
        acl = $acl
        windowsFeatures = @($featureStatus)
        appcmd = [ordered]@{ mode = 'read_only_list'; startCommandInvoked = $false; exitCode = $appcmdExitCode; output = $appcmdOutput }
        recentSystemEvents = $events
        diagnosticErrors = @($diagnosticErrors)
        firewallCanBlockSiteStart = $false
    }
}

function Invoke-MpwFtpSiteRuntimeMethod {
    param(
        [Parameter(Mandatory = $true)]$Site,
        [Parameter(Mandatory = $true)][ValidateSet('Start', 'Stop')][string]$MethodName
    )

    $siteName = [string](Get-MpwInputValue -InputObject $Site -Name 'Name' -DefaultValue '')
    $stateBefore = Get-MpwFtpSiteRuntimeState -Site $Site
    try {
        # FTP has its own runtime methods under the site-level ftpServer
        # configuration element. Site.Start()/Stop() target the generic web
        # site runtime and can fail even while FTPSVC itself is healthy.
        $ftpServer = Get-MpwFtpSiteElement -Site $Site
        $method = $ftpServer.Methods[$MethodName]
        if ($null -eq $method) {
            Throw-MpwFailure -Code "IIS_FTP_SITE_$($MethodName.ToUpperInvariant())_UNAVAILABLE" -Message "The IIS FTP $MethodName runtime method is unavailable." -Command "ftpServer.$MethodName" -Details ([ordered]@{
                siteName = $siteName
                stateBefore = $stateBefore
                technicalMessage = "The site-level ftpServer element does not expose the $MethodName method."
            })
        }
        $instance = $method.CreateInstance()
        [void]$instance.Execute()
    }
    catch {
        $originalError = $_
        if ($null -ne $originalError.Exception.Data -and $originalError.Exception.Data.Contains('MpwCode')) { throw }
        $diagnostic = Get-MpwExceptionDiagnosticDetails -ErrorRecord $originalError
        $service = try { Get-MpwFtpServiceStatus } catch { [ordered]@{ state = 'unknown'; errorCode = 'FTPSVC_STATUS_UNAVAILABLE' } }
        $runtimeDetails = try { Get-MpwIisFtpStartDiagnostics -Site $Site } catch {
            [ordered]@{
                collectedAt = [DateTimeOffset]::UtcNow.ToString('o')
                diagnosticsError = [string]$_.Exception.Message
                firewallCanBlockSiteStart = $false
            }
        }
        $stateAfter = try { Get-MpwFtpSiteRuntimeState -Site $Site } catch { 'unknown' }
        $verb = $MethodName.ToUpperInvariant()
        $failureMessage = if ($MethodName -eq 'Start') { 'The IIS FTP site could not be started.' } else { 'The IIS FTP site could not be stopped.' }
        Throw-MpwFailure -Code "IIS_FTP_SITE_$($verb)_FAILED" -Message $failureMessage -Command "ftpServer.$MethodName" -Details ([ordered]@{
            siteName = $siteName
            stateBefore = $stateBefore
            stateAfter = $stateAfter
            ftpServiceState = [string](Get-MpwInputValue -InputObject $service -Name 'state' -DefaultValue 'unknown')
            technicalMessage = [string]$diagnostic.technicalMessage
            innerTechnicalMessage = [string]$diagnostic.innerTechnicalMessage
            sourceExceptionType = [string]$diagnostic.sourceExceptionType
            hresult = [string]$diagnostic.hresult
            win32Code = Get-MpwWin32CodeFromHresult -Hresult ([string]$diagnostic.hresult)
            diagnostics = $runtimeDetails
        })
    }
}

function Wait-MpwFtpSiteRuntimeState {
    param(
        [Parameter(Mandatory = $true)]$Site,
        [Parameter(Mandatory = $true)][ValidateSet('Started', 'Stopped')][string]$ExpectedState,
        [int]$TimeoutMilliseconds = $script:MpwFtpSiteStateTimeoutMilliseconds
    )

    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
    do {
        $state = Get-MpwFtpSiteRuntimeState -Site $Site
        if ($state -eq $ExpectedState) { return $state }
        Start-Sleep -Milliseconds 200
    } while ([DateTime]::UtcNow -lt $deadline)
    return Get-MpwFtpSiteRuntimeState -Site $Site
}

function Start-MpwSite {
    param([Parameter(Mandatory = $true)]$Site)
    $siteName = [string](Get-MpwInputValue -InputObject $Site -Name 'Name' -DefaultValue '')
    if (-not (Test-MpwSiteStarted -Site $Site)) {
        Invoke-MpwFtpSiteRuntimeMethod -Site $Site -MethodName Start
    }
    $state = Wait-MpwFtpSiteRuntimeState -Site $Site -ExpectedState Started
    if ($state -ne 'Started') {
        $service = try { Get-MpwFtpServiceStatus } catch { [ordered]@{ state = 'unknown'; errorCode = 'FTPSVC_STATUS_UNAVAILABLE' } }
        $runtimeDetails = try { Get-MpwIisFtpStartDiagnostics -Site $Site } catch {
            [ordered]@{
                collectedAt = [DateTimeOffset]::UtcNow.ToString('o')
                diagnosticsError = [string]$_.Exception.Message
                firewallCanBlockSiteStart = $false
            }
        }
        Throw-MpwFailure -Code 'IIS_FTP_SITE_START_FAILED' -Message 'The IIS FTP site did not reach the Started state.' -Command 'ftpServer.Start' -Details ([ordered]@{
            siteName = $siteName
            siteState = $state
            ftpServiceState = [string](Get-MpwInputValue -InputObject $service -Name 'state' -DefaultValue 'unknown')
            technicalMessage = "The FTP site runtime state remained '$state' after $([int]($script:MpwFtpSiteStateTimeoutMilliseconds / 1000)) seconds."
            diagnostics = $runtimeDetails
        })
    }
}

function Stop-MpwSite {
    param([Parameter(Mandatory = $true)]$Site)
    $siteName = [string](Get-MpwInputValue -InputObject $Site -Name 'Name' -DefaultValue '')
    if ((Get-MpwFtpSiteRuntimeState -Site $Site) -ne 'Stopped') {
        Invoke-MpwFtpSiteRuntimeMethod -Site $Site -MethodName Stop
    }
    $state = Wait-MpwFtpSiteRuntimeState -Site $Site -ExpectedState Stopped
    if ($state -ne 'Stopped') {
        Throw-MpwFailure -Code 'IIS_FTP_SITE_STOP_FAILED' -Message 'The IIS FTP site did not reach the Stopped state.' -Command 'ftpServer.Stop' -Details ([ordered]@{
            siteName = $siteName
            siteState = $state
            technicalMessage = "The FTP site runtime state remained '$state' after $([int]($script:MpwFtpSiteStateTimeoutMilliseconds / 1000)) seconds."
        })
    }
}

function Wait-MpwPortListener {
    param(
        [Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$Port,
        [Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$PassiveStart,
        [Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$PassiveEnd,
        [int]$TimeoutMilliseconds = $script:MpwFtpListenerTimeoutMilliseconds
    )

    # Resolve the service once, then poll only the requested TCP endpoint. The
    # previous implementation ran the full conflict/suggestion scan every
    # 250 ms, so an already healthy listener could still take tens of seconds.
    $ftpService = Get-MpwFtpServiceStatus
    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
    do {
        $connectionStatus = Get-MpwTcpListenerConnections -Port $Port
        $connections = @($connectionStatus.connections)
        if ($connections.Count -gt 0) {
            return Get-MpwPortStatus -Port $Port -PassiveStart $PassiveStart -PassiveEnd $PassiveEnd -FtpServiceStatus $ftpService
        }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)
    return Get-MpwPortStatus -Port $Port -PassiveStart $PassiveStart -PassiveEnd $PassiveEnd -FtpServiceStatus $ftpService
}

function Get-MpwElevatedSystemStatus {
    param([Parameter(Mandatory = $true)]$Options)

    $manager = $null
    try {
        $manager = Open-MpwServerManager
        $targetSite = if ($Options.ManagedSiteId -gt 0) { Get-MpwIisSiteById -Manager $manager -SiteId $Options.ManagedSiteId } else { $null }
        if ($null -eq $targetSite) { $targetSite = $manager.Sites[$Options.SiteName] }
        $siteIdentity = if ($null -ne $targetSite) { Get-MpwIisSiteIdentityModel -Site $targetSite } else { $null }
        $sites = @(Get-MpwFtpSites -Manager $manager)
        $siteModel = if ($null -ne $siteIdentity) { $sites | Where-Object { [long]$_.id -eq [long]$siteIdentity.id } | Select-Object -First 1 } else { $null }
        $passive = Get-MpwGlobalPassivePorts -Manager $manager
        $features = @(Get-MpwWindowsFeaturesStatus)
        $service = Get-MpwFtpServiceStatus
        $restartPending = Get-MpwWindowsRestartPendingStatus
        $initialization = Get-MpwIisInitializationReadiness -Features $features -RestartPending $restartPending -Service $service
        $account = Get-MpwLocalAccountStatus -Username $Options.Username
        $port = Get-MpwPortStatus -Port $Options.ControlPort -PassiveStart $Options.PassivePortStart -PassiveEnd $Options.PassivePortEnd -FtpServiceStatus $service
        $physicalPath = $Options.PhysicalPath
        if ($null -ne $siteIdentity -and -not [string]::IsNullOrWhiteSpace([string]$siteIdentity.physicalPath)) {
            $physicalPath = [string]$siteIdentity.physicalPath
        }
        $acl = Get-MpwDirectoryAclStatus -PhysicalPath $physicalPath -Username $Options.Username
        $controlFirewall = Get-MpwFirewallRuleModel -InternalName $script:MpwControlFirewallInternalName -DisplayName $Options.FirewallControlRuleName -LegacyDisplayNames @('MPW IIS FTP Control')
        $passiveFirewall = Get-MpwFirewallRuleModel -InternalName $script:MpwPassiveFirewallInternalName -DisplayName $Options.FirewallPassiveRuleName -LegacyDisplayNames @('MPW IIS FTP Passive')

        $ftpServiceFeatureRaw = $features | Where-Object { $_.featureName -eq 'IIS-FTPSvc' } | Select-Object -First 1
        $ftpExtensibilityFeatureRaw = $features | Where-Object { $_.featureName -eq 'IIS-FTPExtensibility' } | Select-Object -First 1
        $managementFeatureRaw = $features | Where-Object { $_.featureName -eq 'IIS-ManagementScriptingTools' } | Select-Object -First 1
        $ftpServiceFeature = [ordered]@{ featureName = 'IIS-FTPSvc'; installed = if ($null -ne $ftpServiceFeatureRaw -and $ftpServiceFeatureRaw.state -ne 'unknown') { $ftpServiceFeatureRaw.state -eq 'Enabled' } else { $null }; state = if ($null -ne $ftpServiceFeatureRaw) { [string]$ftpServiceFeatureRaw.state } else { 'unknown' }; error = if ($null -ne $ftpServiceFeatureRaw) { [string](Get-MpwInputValue -InputObject $ftpServiceFeatureRaw -Name 'errorCode' -DefaultValue '') } else { '' } }
        $ftpExtensibilityFeature = [ordered]@{ featureName = 'IIS-FTPExtensibility'; installed = if ($null -ne $ftpExtensibilityFeatureRaw -and $ftpExtensibilityFeatureRaw.state -ne 'unknown') { $ftpExtensibilityFeatureRaw.state -eq 'Enabled' } else { $null }; state = if ($null -ne $ftpExtensibilityFeatureRaw) { [string]$ftpExtensibilityFeatureRaw.state } else { 'unknown' }; error = if ($null -ne $ftpExtensibilityFeatureRaw) { [string](Get-MpwInputValue -InputObject $ftpExtensibilityFeatureRaw -Name 'errorCode' -DefaultValue '') } else { '' } }
        $managementFeature = [ordered]@{ featureName = 'IIS-ManagementScriptingTools'; installed = if ($null -ne $managementFeatureRaw -and $managementFeatureRaw.state -ne 'unknown') { $managementFeatureRaw.state -eq 'Enabled' } else { $null }; state = if ($null -ne $managementFeatureRaw) { [string]$managementFeatureRaw.state } else { 'unknown' }; error = if ($null -ne $managementFeatureRaw) { [string](Get-MpwInputValue -InputObject $managementFeatureRaw -Name 'errorCode' -DefaultValue '') } else { '' } }

        $siteExists = $null -ne $siteIdentity
        $siteIsFtp = $null -ne $siteModel
        $bindingValue = ''
        if ($siteIsFtp) {
            $ftpBinding = $siteModel.bindings | Where-Object { $_.protocol -eq 'ftp' } | Select-Object -First 1
            if ($null -ne $ftpBinding) { $bindingValue = [string]$ftpBinding.bindingInformation }
        }
        $bindingHost = ''
        if ($bindingValue -match '^(.+):(\d+):(.*)$') { $bindingHost = [string]$Matches[1] }
        $bindingCorrect = [bool]($siteExists -and $bindingValue -eq $Options.Binding)
        $basicEnabled = if ($siteIsFtp) { [bool]$siteModel.authentication.basicEnabled } else { $false }
        $anonymousEnabled = if ($siteIsFtp) { [bool]$siteModel.authentication.anonymousEnabled } else { $false }
        $authCorrect = [bool]($siteIsFtp -and $basicEnabled -and -not $anonymousEnabled)
        $authorizationRule = if ($siteIsFtp) { $siteModel.authorization | Where-Object { $_.accessType -eq 'Allow' -and $_.users -eq $Options.Username } | Select-Object -First 1 } else { $null }
        $authorizationRead = [bool]($null -ne $authorizationRule -and [string]$authorizationRule.permissions -match 'Read')
        $authorizationWrite = [bool]($null -ne $authorizationRule -and [string]$authorizationRule.permissions -match 'Write')
        $authorizationEvaluation = if ($siteIsFtp) {
            Get-MpwFtpAuthorizationEvaluation -Rules @($siteModel.authorization) -Username $Options.Username
        }
        else {
            [ordered]@{ correct = $false; managedAllow = $false; conflictingDeny = $false; conflicts = @() }
        }
        $authorizationCorrect = [bool]$authorizationEvaluation.correct
        $siteId = if ($siteExists) { [long]$siteIdentity.id } else { $null }
        $siteIdMatches = [bool]($siteExists -and (($Options.ManagedSiteId -gt 0 -and $siteId -eq $Options.ManagedSiteId) -or ($Options.ManagedSiteId -eq 0 -and [string]$siteIdentity.name -eq [string]$Options.SiteName)))
        $sameNameIdConflict = [bool]($siteExists -and -not $siteIdMatches)
        # Ownership and configuration health are intentionally independent.
        # A broken authorization rule on the persisted Site ID is repairable;
        # it must not make the site look like an unrelated adoption candidate.
        $siteManaged = [bool]($siteIdMatches -and $siteIsFtp -and $account.managed -eq $true)
        $siteOwned = $siteManaged
        $sameNameOwnershipConflict = [bool]($siteExists -and -not $siteOwned)
        $sslEnabled = if ($siteIsFtp) { [bool]($siteModel.ssl.controlChannelPolicy -ne 'SslAllow' -or $siteModel.ssl.dataChannelPolicy -ne 'SslAllow') } else { $false }
        $passiveCorrect = [int]$passive.start -eq $Options.PassivePortStart -and [int]$passive.end -eq $Options.PassivePortEnd
        $controlFirewallCorrect = [bool]($controlFirewall.exists -eq $true -and $controlFirewall.enabled -eq $true -and [string]$controlFirewall.profile -eq 'Any' -and [string]$controlFirewall.remoteAddress -eq 'LocalSubnet' -and [string]$controlFirewall.localPort -eq [string]$Options.ControlPort -and [string]$controlFirewall.protocol -eq 'TCP')
        $expectedPassiveRange = "$($Options.PassivePortStart)-$($Options.PassivePortEnd)"
        $passiveFirewallCorrect = [bool]($passiveFirewall.exists -eq $true -and $passiveFirewall.enabled -eq $true -and [string]$passiveFirewall.profile -eq 'Any' -and [string]$passiveFirewall.remoteAddress -eq 'LocalSubnet' -and [string]$passiveFirewall.localPort -eq $expectedPassiveRange -and [string]$passiveFirewall.protocol -eq 'TCP')
        $resolvedSiteName = if ($siteExists) { [string]$siteIdentity.name } else { $Options.SiteName }
        $otherSites = @(Find-MpwPortSites -Manager $manager -Port $Options.ControlPort -ExcludeSiteName $resolvedSiteName)
        $pathConflict = $false
        if ($siteExists -and -not [string]::IsNullOrWhiteSpace($Options.PhysicalPath)) {
            try {
                $pathConflict = [bool]([IO.Path]::GetFullPath([string]$siteIdentity.physicalPath).TrimEnd('\') -ne [IO.Path]::GetFullPath([string]$Options.PhysicalPath).TrimEnd('\'))
            }
            catch { $pathConflict = $true }
        }
        $conflictItems = [Collections.Generic.List[object]]::new()
        if ($sameNameOwnershipConflict) {
            [void]$conflictItems.Add([ordered]@{
                type = 'site'
                code = 'IIS_SITE_ADOPTION_REQUIRED'
                message = if ($sameNameIdConflict) { 'An IIS site with the configured name has a different identity and requires explicit adoption.' } elseif (-not $siteIsFtp) { 'An IIS site with the configured name has no FTP binding and requires explicit adoption.' } else { 'The configured IIS site does not have the required managed account marker; explicit adoption is required.' }
                siteName = [string]$siteIdentity.name
                physicalPath = [string]$siteIdentity.physicalPath
                binding = $bindingValue
                port = $Options.ControlPort
                status = [string]$siteIdentity.state
                adoptable = $true
                expectedSiteId = [long]$Options.ManagedSiteId
                actualSiteId = $siteId
            })
        }
        foreach ($otherSite in $otherSites) {
            $otherBinding = $otherSite.bindings | Where-Object { $_.protocol -eq 'ftp' -and $_.port -eq $Options.ControlPort } | Select-Object -First 1
            $verifiedTestSite = [string]$otherSite.name -eq 'MPW-IIS-FTP-Test'
            [void]$conflictItems.Add([ordered]@{ type = 'site'; code = 'IIS_SITE_PORT_CONFLICT'; message = 'Another IIS FTP site uses the configured control port. Correct the binding manually without modifying the unrelated site automatically.'; siteName = [string]$otherSite.name; physicalPath = [string]$otherSite.physicalPath; binding = if ($null -ne $otherBinding) { [string]$otherBinding.bindingInformation } else { '' }; port = $Options.ControlPort; status = [string]$otherSite.state; adoptable = $false; verifiedWithNikon = $verifiedTestSite; canChangePort = $true; availablePorts = @($port.availablePorts); recommendation = 'Use the built-in guide to choose an available control port and update the IIS binding manually.' })
        }
        if ($port.reserved) { [void]$conflictItems.Add([ordered]@{ type = 'port'; code = 'FTP_CONTROL_PORT_RESERVED'; message = 'The configured control port is reserved by Windows.'; port = $Options.ControlPort; source = 'windowsReservedPort'; adoptable = $false; canChangePort = $true; availablePorts = @($port.availablePorts); recommendation = 'Choose one of the available control ports.' }) }
        if ($port.conflict) { [void]$conflictItems.Add([ordered]@{ type = 'port'; code = 'PORT_USED_BY_OTHER_PROCESS'; message = 'The configured control port is owned by another process.'; port = $Options.ControlPort; pid = $port.pid; processName = [string]$port.processName; source = 'process'; adoptable = $false; canChangePort = $true; availablePorts = @($port.availablePorts); recommendation = 'Do not stop the other process automatically. Choose another available control port.' }) }
        if ($account.conflict) { [void]$conflictItems.Add([ordered]@{ type = 'user'; code = 'FTP_ACCOUNT_CONFLICT'; message = 'The configured username is not a Media Photo Workbench managed account.'; adoptable = $false }) }
        $warnings = [Collections.Generic.List[string]]::new()
        if ($sameNameOwnershipConflict) {
            [void]$warnings.Add((if ($sameNameIdConflict) { 'The configured IIS site identity does not match the registered Site ID; verify it manually.' } elseif (-not $siteIsFtp) { 'The configured IIS site has no FTP binding; correct it manually.' } else { 'The configured IIS site account marker is not managed; verify it manually.' }))
        }
        if ($account.conflict -eq $true) { [void]$warnings.Add('The configured username is not marked as a Media Photo Workbench managed account.') }
        if ($acl.broadInheritedAccess -eq $true) { [void]$warnings.Add('The FTP root inherits write-capable access for broad Windows principals.') }
        if (-not $controlFirewallCorrect -or -not $passiveFirewallCorrect) { [void]$warnings.Add('One or more Windows Firewall FTP rules do not match the expected LocalSubnet scope.') }
        $missingItems = [Collections.Generic.List[string]]::new()
        if (-not $siteIsFtp) { [void]$missingItems.Add('IIS_FTP_SITE') }
        if ($account.exists -eq $false) { [void]$missingItems.Add('FTP_ACCOUNT') }
        if ($acl.exists -eq $false) { [void]$missingItems.Add('FTP_PATH') }
        if ($controlFirewall.exists -eq $false) { [void]$missingItems.Add('FIREWALL_CONTROL_RULE') }
        if ($passiveFirewall.exists -eq $false) { [void]$missingItems.Add('FIREWALL_PASSIVE_RULE') }

        $iisSiteNames = @()
        if ($bindingCorrect) { $iisSiteNames += $resolvedSiteName }
        $iisSiteNames += @($otherSites | ForEach-Object { [string]$_.name })
        $port.iisSiteNames = @($iisSiteNames | Select-Object -Unique)
        $port.iisSiteName = if ($port.iisSiteNames.Count -gt 0) { [string]$port.iisSiteNames[0] } else { '' }
        $port.ownedByManagedSite = [bool]($siteManaged -and $bindingCorrect)
        $port.adoptable = [bool](@($conflictItems | Where-Object { $_.type -eq 'site' -and $_.adoptable -eq $true }).Count -eq 1)
        $port.conflict = [bool]($port.reserved -or $port.conflict -or $sameNameOwnershipConflict -or $otherSites.Count -gt 0)
        $initializationState = if ([string]$initialization.state -eq 'ready' -and -not $siteIsFtp) { 'site_missing' } else { [string]$initialization.state }
        $unrelatedAutoStartSites = @($sites | Where-Object {
            [bool](Get-MpwInputValue -InputObject $_ -Name 'serverAutoStart' -DefaultValue $false) -and
            (-not $siteExists -or [long]$_.id -ne $siteId)
        } | ForEach-Object { [ordered]@{ id = [long]$_.id; name = [string]$_.name; state = [string]$_.state } })
        $completedStages = [Collections.Generic.List[string]]::new()
        if (@($features | Where-Object { [string]$_.state -ne 'Enabled' }).Count -eq 0) { [void]$completedStages.Add('windows_features') }
        if ([bool]$initialization.managementApi.exists -and [bool]$initialization.configuration.exists) { [void]$completedStages.Add('iis_configuration') }
        if ($service.exists -eq $true) { [void]$completedStages.Add('ftp_service_registered') }
        if ($service.running -eq $true) { [void]$completedStages.Add('ftp_service_running') }
        if ($siteIsFtp) { [void]$completedStages.Add('ftp_site') }

        return [ordered]@{
            provider = 'iis'
            platform = [ordered]@{ isWindows = $true; isWindows11 = [Environment]::OSVersion.Version.Build -ge 22000; supported = [Environment]::OSVersion.Version.Build -ge 22000; version = [Environment]::OSVersion.Version.ToString() }
            windowsFeatures = [ordered]@{ ftpService = $ftpServiceFeature; ftpExtensibility = $ftpExtensibilityFeature; managementTools = $managementFeature }
            service = $service
            serviceDependencies = @($service.dependencies)
            unrelatedAutoStartSites = $unrelatedAutoStartSites
            initializationState = $initializationState
            resumeState = if ($initializationState -eq 'restart_pending') { 'restart_required' } elseif ($initializationState -eq 'blocked') { 'blocked' } else { 'none' }
            completedStages = @($completedStages)
            nextStage = switch ($initializationState) {
                'features_missing' { 'windows_features' }
                'restart_pending' { 'windows_restart' }
                'config_not_ready' { 'iis_configuration' }
                'service_missing' { 'ftp_service_registration' }
                'service_disabled' { 'ftp_service_startup' }
                'service_stopped' { 'ftp_service_start' }
                'service_pending' { 'ftp_service_wait' }
                'site_missing' { 'ftp_site' }
                'blocked' { 'manual_repair' }
                default { 'verification' }
            }
            safeToRetry = [bool]($initializationState -ne 'blocked')
            site = [ordered]@{ id = $siteId; exists = $siteExists; name = $resolvedSiteName; status = if ($siteExists) { [string]$siteIdentity.state } else { 'notFound' }; started = [bool]($siteExists -and [string]$siteIdentity.state -eq 'Started'); physicalPath = if ($siteExists) { [string]$siteIdentity.physicalPath } else { '' }; binding = $bindingValue; controlPort = $Options.ControlPort; sslEnabled = $sslEnabled; adoptable = $sameNameOwnershipConflict; managed = $siteManaged }
            binding = [ordered]@{ value = $bindingValue; host = $bindingHost; port = $Options.ControlPort; allUnassigned = $bindingCorrect; correct = $bindingCorrect }
            authentication = [ordered]@{ basicEnabled = $basicEnabled; anonymousEnabled = $anonymousEnabled; correct = $authCorrect }
            authorization = [ordered]@{
                configured = $null -ne $authorizationRule
                username = $Options.Username
                read = $authorizationRead
                write = $authorizationWrite
                correct = $authorizationCorrect
                conflictingDeny = [bool]$authorizationEvaluation.conflictingDeny
                conflicts = @($authorizationEvaluation.conflicts)
            }
            account = $account
            acl = $acl
            port = $port
            passivePorts = [ordered]@{
                start = [int]$passive.start
                end = [int]$passive.end
                configured = [bool]([int]$passive.start -gt 0 -and [int]$passive.end -gt 0)
                correct = $passiveCorrect
            }
            firewall = [ordered]@{
                controlRule = [ordered]@{ name = $Options.FirewallControlRuleName; exists = $controlFirewall.exists; enabled = $controlFirewall.enabled; profile = [string]$controlFirewall.profile; remoteAddress = [string]$controlFirewall.remoteAddress; correct = $controlFirewallCorrect }
                passiveRule = [ordered]@{ name = $Options.FirewallPassiveRuleName; exists = $passiveFirewall.exists; enabled = $passiveFirewall.enabled; profile = [string]$passiveFirewall.profile; remoteAddress = [string]$passiveFirewall.remoteAddress; correct = $passiveFirewallCorrect }
                correct = [bool]($controlFirewallCorrect -and $passiveFirewallCorrect)
            }
            conflicts = [ordered]@{ portConflict = [bool]$port.conflict; siteConflict = [bool]($sameNameOwnershipConflict -or $otherSites.Count -gt 0); userConflict = [bool]$account.conflict; pathConflict = $pathConflict; items = @($conflictItems) }
            repairable = [bool](-not $port.conflict -and -not $account.conflict -and -not $sameNameOwnershipConflict -and $otherSites.Count -eq 0)
            missingItems = @($missingItems)
            warnings = @($warnings)
            lastError = $null
            networkAddresses = Get-MpwNetworkAddressStatus
            requiresAdmin = $false
        }
    }
    finally {
        if ($null -ne $manager) { $manager.Dispose() }
    }
}
