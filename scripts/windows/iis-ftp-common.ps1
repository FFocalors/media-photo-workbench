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
        '^(IIS_FTP_NOT_INSTALLED|IIS_FTP_INSTALL_FAILED|IIS_FTP_FEATURE_|IIS_FEATURE_|WINDOWS_FEATURE_|WINDOWS_RESTART_REQUIRED)' { return 4 }
        '^(IIS_SITE_|SITE_|MANAGED_SITE_ID_|PHYSICAL_PATH_|FTP_CONTROL_PORT_IN_USE|FTP_CONTROL_PORT_RESERVED|PORT_USED_BY_OTHER_PROCESS|NO_AVAILABLE_FTP_PORT|FTP_BINDING_)' { return 5 }
        '^(FTP_ACCOUNT_|FTP_CREDENTIAL_)' { return 6 }
        '^(FTP_ACL_|FTP_DIRECTORY_ACL_|ACL_)' { return 7 }
        '^(FIREWALL_)' { return 8 }
        '^(IIS_SERVICE_|IIS_FTP_SERVICE_|IIS_FTP_SITE_(START|STOP)|IIS_FTP_LISTENER_|FTP_SERVICE_|CONTROL_PORT_NOT_LISTENING|CONTROL_PORT_LISTENER_|FTPSVC_)' { return 9 }
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
            Remove-Item -LiteralPath $fullPath -Force -ErrorAction Stop
        }
        Move-Item -LiteralPath $temporaryPath -Destination $fullPath -Force -ErrorAction Stop
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
        'allowLegacyFirewallRuleUpdate',
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

function Assert-MpwPassword {
    param([AllowNull()]$Password)

    if ($null -eq $Password) {
        Throw-MpwFailure -Code 'FTP_PASSWORD_REQUIRED' -Message 'An FTP password is required.'
    }
    $value = [string]$Password
    if ($value.Length -lt 8 -or $value.Length -gt 127 -or $value.Contains("`0") -or $value.Contains("`r") -or $value.Contains("`n")) {
        Throw-MpwFailure -Code 'FTP_PASSWORD_INVALID' -Message 'The FTP password does not meet the required length or character rules.'
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

function Assert-MpwPhysicalPath {
    param(
        [Parameter(Mandatory = $true)][string]$PhysicalPath,
        [switch]$Create,
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
        if (-not $Create) {
            Throw-MpwFailure -Code 'FTP_PATH_INVALID' -Message 'The FTP physical path does not exist.'
        }
        try {
            [void][IO.Directory]::CreateDirectory($fullPath)
        }
        catch {
            Throw-MpwFailure -Code 'FTP_PATH_CREATE_FAILED' -Message 'The FTP physical path could not be created.'
        }
    }

    $item = Get-Item -LiteralPath $fullPath -Force -ErrorAction Stop
    if (Test-MpwUnsafeReparsePoint -Item $item) {
        Throw-MpwFailure -Code 'FTP_PATH_INVALID' -Message 'The FTP physical path cannot be a symbolic link or junction.'
    }
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
    $allowLegacyFirewallRuleUpdate = $false
    if (Test-MpwInputProperty -InputObject $InputObject -Name 'allowLegacyFirewallRuleUpdate') {
        $allowLegacyValue = Get-MpwInputValue -InputObject $InputObject -Name 'allowLegacyFirewallRuleUpdate'
        if ($allowLegacyValue -isnot [bool]) {
            Throw-MpwFailure -Code 'INVALID_PARAMETER' -Message 'allowLegacyFirewallRuleUpdate must be a boolean.'
        }
        $allowLegacyFirewallRuleUpdate = [bool]$allowLegacyValue
    }

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
        AllowLegacyFirewallRuleUpdate = $allowLegacyFirewallRuleUpdate
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

function Ensure-MpwManagedLocalAccount {
    param(
        [Parameter(Mandatory = $true)][string]$Username,
        [AllowNull()]$Password,
        [switch]$RequirePassword
    )

    Import-MpwLocalAccountsModule
    $existing = Get-LocalUser -Name $Username -ErrorAction SilentlyContinue
    if ($null -ne $existing -and [string]$existing.Description -ne $script:MpwManagedAccountDescription) {
        Throw-MpwFailure -Code 'FTP_ACCOUNT_CONFLICT' -Message 'The requested local username is already owned by another account.'
    }

    $created = $false
    if ($null -eq $existing) {
        $plainPassword = Assert-MpwPassword -Password $Password
        $securePassword = ConvertTo-SecureString -String $plainPassword -AsPlainText -Force
        $plainPassword = $null
        try {
            [void](New-LocalUser -Name $Username -Password $securePassword -Description $script:MpwManagedAccountDescription -AccountNeverExpires -PasswordNeverExpires -UserMayNotChangePassword -ErrorAction Stop)
            $created = $true
        }
        catch {
            Throw-MpwFailure -Code 'FTP_ACCOUNT_CREATE_FAILED' -Message 'The managed FTP account could not be created.'
        }
    }
    elseif ($RequirePassword -or $null -ne $Password) {
        $plainPassword = Assert-MpwPassword -Password $Password
        $securePassword = ConvertTo-SecureString -String $plainPassword -AsPlainText -Force
        $plainPassword = $null
        try {
            Set-LocalUser -Name $Username -Password $securePassword -Description $script:MpwManagedAccountDescription -UserMayChangePassword $false -PasswordNeverExpires $true -ErrorAction Stop
        }
        catch {
            Throw-MpwFailure -Code 'FTP_CREDENTIAL_UPDATE_FAILED' -Message 'The managed FTP password could not be updated.'
        }
    }

    try {
        Enable-LocalUser -Name $Username -ErrorAction Stop
    }
    catch {
        Throw-MpwFailure -Code 'FTP_ACCOUNT_CREATE_FAILED' -Message 'The managed FTP account could not be enabled.'
    }

    return [ordered]@{
        username = $Username
        created = $created
        passwordReset = [bool]($created -or $RequirePassword -or $null -ne $Password)
    }
}

function Remove-MpwManagedLocalAccount {
    param([Parameter(Mandatory = $true)][string]$Username)

    Import-MpwLocalAccountsModule
    $existing = Get-LocalUser -Name $Username -ErrorAction SilentlyContinue
    if ($null -ne $existing -and [string]$existing.Description -eq $script:MpwManagedAccountDescription) {
        Remove-LocalUser -Name $Username -ErrorAction Stop
    }
}

function Disable-MpwManagedLocalAccount {
    param([Parameter(Mandatory = $true)][string]$Username)

    Import-MpwLocalAccountsModule
    $existing = Get-LocalUser -Name $Username -ErrorAction SilentlyContinue
    if ($null -ne $existing -and [string]$existing.Description -eq $script:MpwManagedAccountDescription) {
        if ([bool]$existing.Enabled) {
            Disable-LocalUser -Name $Username -ErrorAction Stop
            return $true
        }
        return $false
    }
    return $false
}

function Enable-MpwManagedLocalAccount {
    param([Parameter(Mandatory = $true)][string]$Username)

    Import-MpwLocalAccountsModule
    $existing = Get-LocalUser -Name $Username -ErrorAction SilentlyContinue
    if ($null -eq $existing -or [string]$existing.Description -ne $script:MpwManagedAccountDescription) {
        return $false
    }
    if (-not [bool]$existing.Enabled) {
        Enable-LocalUser -Name $Username -ErrorAction Stop
    }
    return $true
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

function Get-MpwDirectoryAclDiagnostics {
    param([Parameter(Mandatory = $true)][string]$PhysicalPath)

    $details = [ordered]@{
        path = $PhysicalPath
        exists = [IO.Directory]::Exists($PhysicalPath)
        owner = ''
        protected = $null
        canonical = $null
        ruleCount = 0
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

function Get-MpwDirectoryAclSnapshot {
    param([Parameter(Mandatory = $true)][string]$PhysicalPath)

    if (-not [IO.Directory]::Exists($PhysicalPath)) { return $null }
    try {
        $acl = [IO.Directory]::GetAccessControl($PhysicalPath)
        return [ordered]@{
            path = $PhysicalPath
            sddl = $acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)
            owner = [string]$acl.Owner
            protected = [bool]$acl.AreAccessRulesProtected
            canonical = [bool]$acl.AreAccessRulesCanonical
            ruleCount = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])).Count
        }
    }
    catch {
        $diagnostic = Get-MpwExceptionDiagnosticDetails -ErrorRecord $_
        Throw-MpwFailure -Code 'FTP_ACL_SNAPSHOT_FAILED' -Message 'The FTP directory ACL snapshot could not be captured.' -Command 'Directory.GetAccessControl/GetSecurityDescriptorSddlForm' -Details ([ordered]@{
            path = $PhysicalPath
            technicalMessage = [string]$diagnostic.technicalMessage
            sourceExceptionType = [string]$diagnostic.sourceExceptionType
            hresult = [string]$diagnostic.hresult
        })
    }
}

function Restore-MpwDirectoryAclSnapshot {
    param(
        [Parameter(Mandatory = $true)][string]$PhysicalPath,
        [Parameter(Mandatory = $true)]$Snapshot
    )

    try {
        $descriptor = [Security.AccessControl.DirectorySecurity]::new()
        $descriptor.SetSecurityDescriptorSddlForm(
            [string]$Snapshot.sddl,
            [Security.AccessControl.AccessControlSections]::Access
        )
        [IO.Directory]::SetAccessControl($PhysicalPath, $descriptor)
        $restored = [IO.Directory]::GetAccessControl($PhysicalPath)
        $restoredSddl = $restored.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)
        $verified = [string]$restoredSddl -eq [string]$Snapshot.sddl
        if (-not $verified) {
            Throw-MpwFailure -Code 'FTP_ACL_ROLLBACK_VERIFY_FAILED' -Message 'The FTP directory ACL rollback did not reproduce the captured DACL.' -Command 'Directory.SetAccessControl/GetSecurityDescriptorSddlForm' -Details ([ordered]@{
                path = $PhysicalPath
                expectedProtected = [bool]$Snapshot.protected
                actualProtected = [bool]$restored.AreAccessRulesProtected
                expectedCanonical = [bool]$Snapshot.canonical
                actualCanonical = [bool]$restored.AreAccessRulesCanonical
                expectedRuleCount = [int]$Snapshot.ruleCount
                actualRuleCount = @($restored.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])).Count
                technicalMessage = 'The post-rollback DACL differs from the preflight SDDL snapshot.'
            })
        }
        return [ordered]@{
            succeeded = $true
            protected = [bool]$restored.AreAccessRulesProtected
            canonical = [bool]$restored.AreAccessRulesCanonical
            ruleCount = @($restored.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])).Count
        }
    }
    catch {
        if ($null -ne $_.Exception.Data -and $_.Exception.Data.Contains('MpwCode')) { throw }
        $diagnostic = Get-MpwExceptionDiagnosticDetails -ErrorRecord $_
        Throw-MpwFailure -Code 'FTP_ACL_ROLLBACK_FAILED' -Message 'The FTP directory ACL could not be restored from its SDDL snapshot.' -Command 'DirectorySecurity.SetSecurityDescriptorSddlForm/Directory.SetAccessControl' -Details ([ordered]@{
            path = $PhysicalPath
            technicalMessage = [string]$diagnostic.technicalMessage
            sourceExceptionType = [string]$diagnostic.sourceExceptionType
            hresult = [string]$diagnostic.hresult
        })
    }
}

function ConvertTo-MpwCanonicalDirectorySecurity {
    param(
        [Parameter(Mandatory = $true)]$Acl,
        [bool]$ProtectAccessRules = [bool]$Acl.AreAccessRulesProtected,
        [bool]$IncludeInheritedRules = [bool]$Acl.AreAccessRulesProtected
    )

    $canonical = [Security.AccessControl.DirectorySecurity]::new()
    $canonical.SetAccessRuleProtection($ProtectAccessRules, $false)
    $rules = @($Acl.GetAccessRules($true, $IncludeInheritedRules, [Security.Principal.SecurityIdentifier]))
    $orderedRules = @($rules | Where-Object { $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Deny }) +
        @($rules | Where-Object { $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow })
    foreach ($existingRule in $orderedRules) {
        $copy = [Security.AccessControl.FileSystemAccessRule]::new(
            $existingRule.IdentityReference,
            $existingRule.FileSystemRights,
            $existingRule.InheritanceFlags,
            $existingRule.PropagationFlags,
            $existingRule.AccessControlType
        )
        [void]$canonical.AddAccessRule($copy)
    }
    if (-not $canonical.AreAccessRulesCanonical) {
        Throw-MpwFailure -Code 'FTP_ACL_FAILED' -Message 'The FTP directory ACL could not be converted to canonical order.' -Command 'DirectorySecurity.AddAccessRule' -Details ([ordered]@{
            technicalMessage = 'The rebuilt DACL is still reported as non-canonical.'
            sourceRuleCount = $rules.Count
        })
    }
    return $canonical
}

function Grant-MpwDirectoryAccess {
    param(
        [Parameter(Mandatory = $true)][string]$PhysicalPath,
        [Parameter(Mandatory = $true)][string]$Username
    )

    $path = Assert-MpwPhysicalPath -PhysicalPath $PhysicalPath -Create
    $sid = Get-MpwAccountSid -Username $Username
    $aclStage = 'read_acl'
    try {
        $acl = [IO.Directory]::GetAccessControl($path)
        $canonicalized = -not [bool]$acl.AreAccessRulesCanonical
        if ($canonicalized) {
            $aclStage = 'canonicalize_acl'
            $acl = ConvertTo-MpwCanonicalDirectorySecurity -Acl $acl
        }
        $aclStage = 'remove_existing_account_rules'
        $explicit = @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]) | Where-Object { $_.IdentityReference -eq $sid })
        foreach ($rule in $explicit) {
            [void]$acl.RemoveAccessRuleSpecific($rule)
        }
        $aclStage = 'add_account_rule'
        $rule = [Security.AccessControl.FileSystemAccessRule]::new(
            $sid,
            [Security.AccessControl.FileSystemRights]::Modify,
            [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit,
            [Security.AccessControl.PropagationFlags]::None,
            [Security.AccessControl.AccessControlType]::Allow
        )
        $acl.AddAccessRule($rule)
        $aclStage = 'write_acl'
        [IO.Directory]::SetAccessControl($path, $acl)
        $aclStage = 'verify_acl'
        $after = Get-MpwDirectoryAclStatus -PhysicalPath $path -Username $Username
        if ($after.readWriteAllowed -ne $true -or $after.correct -ne $true) {
            Throw-MpwFailure -Code 'FTP_ACL_EFFECTIVE_ACCESS_DENIED' -Message 'The FTP account still lacks effective read/write access after the ACL update.' -Command 'Directory.GetAccessControl' -Details ([ordered]@{
                path = $path
                username = $Username
                accountSid = [string]$sid.Value
                technicalMessage = 'A Deny ACE or another effective-permission conflict still overrides the managed FTP account rights.'
                acl = Get-MpwDirectoryAclDiagnostics -PhysicalPath $path
            })
        }
        return [ordered]@{
            path = $path
            accountSid = [string]$sid.Value
            canonicalized = $canonicalized
            canonical = [bool](Get-MpwDirectoryAclDiagnostics -PhysicalPath $path).canonical
            readWriteAllowed = $true
        }
    }
    catch {
        if ($null -ne $_.Exception.Data -and $_.Exception.Data.Contains('MpwCode')) { throw }
        $diagnostic = Get-MpwExceptionDiagnosticDetails -ErrorRecord $_
        Throw-MpwFailure -Code 'FTP_ACL_FAILED' -Message 'Read/write ACL access could not be granted to the managed FTP account.' -Command 'DirectorySecurity/Directory.SetAccessControl' -Details ([ordered]@{
            path = $path
            username = $Username
            accountSid = [string]$sid.Value
            aclStage = $aclStage
            technicalMessage = [string]$diagnostic.technicalMessage
            sourceExceptionType = [string]$diagnostic.sourceExceptionType
            hresult = [string]$diagnostic.hresult
            acl = Get-MpwDirectoryAclDiagnostics -PhysicalPath $path
        })
    }
}

function Test-MpwWriteCapableFileSystemRights {
    param([Parameter(Mandatory = $true)][Security.AccessControl.FileSystemRights]$Rights)

    # FileSystemRights.Modify also contains read bits, so testing for any
    # overlap with Modify would incorrectly classify read-only rules as write
    # access. Use only the mutation-capable bits.
    $writeMask =
        [Security.AccessControl.FileSystemRights]::WriteData -bor
        [Security.AccessControl.FileSystemRights]::AppendData -bor
        [Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
        [Security.AccessControl.FileSystemRights]::WriteAttributes -bor
        [Security.AccessControl.FileSystemRights]::Delete -bor
        [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
        [Security.AccessControl.FileSystemRights]::ChangePermissions -bor
        [Security.AccessControl.FileSystemRights]::TakeOwnership
    return (([long]$Rights -band [long]$writeMask) -ne 0)
}

function Get-MpwBroadDirectoryWriteRules {
    param([Parameter(Mandatory = $true)]$Acl)

    $broadSids = @('S-1-1-0', 'S-1-5-11', 'S-1-5-32-545')
    return @($Acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | Where-Object {
        $broadSids -contains [string]$_.IdentityReference.Value -and
        $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
        (Test-MpwWriteCapableFileSystemRights -Rights $_.FileSystemRights)
    })
}

function Remove-MpwBroadDirectoryWriteAccess {
    param([Parameter(Mandatory = $true)][string]$PhysicalPath)

    $path = Assert-MpwPhysicalPath -PhysicalPath $PhysicalPath -Create
    try {
        $acl = [IO.Directory]::GetAccessControl($path)
        $candidates = @(Get-MpwBroadDirectoryWriteRules -Acl $acl)
        if ($candidates.Count -eq 0) {
            return [ordered]@{
                path = $path
                changed = $false
                removedRuleCount = 0
                removedRules = @()
                inheritedRulesConverted = $false
                currentUserAccessAdded = $false
            }
        }

        $inheritedRulesConverted = @($candidates | Where-Object { $_.IsInherited }).Count -gt 0
        if ($inheritedRulesConverted) {
            # Converting inherited ACEs in-place can leave an explicit Allow
            # before an explicit Deny. .NET then reports the DACL as
            # non-canonical and refuses later ACL modifications. Rebuild the
            # identical rule set in canonical order, protect it, and only then
            # remove the explicitly confirmed broad write rules.
            $acl = ConvertTo-MpwCanonicalDirectorySecurity -Acl $acl -ProtectAccessRules $true -IncludeInheritedRules $true
            $candidates = @(Get-MpwBroadDirectoryWriteRules -Acl $acl)
        }
        elseif (-not $acl.AreAccessRulesCanonical) {
            $acl = ConvertTo-MpwCanonicalDirectorySecurity -Acl $acl
            $candidates = @(Get-MpwBroadDirectoryWriteRules -Acl $acl)
        }

        $currentUserAccessAdded = $false
        $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
        if ($null -ne $currentSid) {
            $currentRules = @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]) | Where-Object {
                $_.IdentityReference -eq $currentSid -and
                $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow
            })
            $hasCurrentModify = @($currentRules | Where-Object {
                (($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::Modify) -eq [Security.AccessControl.FileSystemRights]::Modify)
            }).Count -gt 0
            if (-not $hasCurrentModify) {
                $currentRule = [Security.AccessControl.FileSystemAccessRule]::new(
                    $currentSid,
                    [Security.AccessControl.FileSystemRights]::Modify,
                    [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit,
                    [Security.AccessControl.PropagationFlags]::None,
                    [Security.AccessControl.AccessControlType]::Allow
                )
                [void]$acl.AddAccessRule($currentRule)
                $currentUserAccessAdded = $true
            }
        }

        $removedRules = [Collections.Generic.List[object]]::new()
        foreach ($rule in $candidates) {
            [void]$acl.RemoveAccessRuleSpecific($rule)
            [void]$removedRules.Add([ordered]@{
                identity = [string]$rule.IdentityReference.Value
                rights = [string]$rule.FileSystemRights
                inherited = [bool]$rule.IsInherited
            })
        }
        [IO.Directory]::SetAccessControl($path, $acl)
        $after = [IO.Directory]::GetAccessControl($path)
        if (-not $after.AreAccessRulesCanonical) {
            Throw-MpwFailure -Code 'FTP_ACL_TIGHTEN_FAILED' -Message 'The confirmed ACL update produced a non-canonical DACL.' -Command 'Directory.GetAccessControl' -Details ([ordered]@{
                path = $path
                technicalMessage = 'The post-update directory DACL is not in canonical order.'
            })
        }
        return [ordered]@{
            path = $path
            changed = $removedRules.Count -gt 0 -or $currentUserAccessAdded -or $inheritedRulesConverted
            removedRuleCount = $removedRules.Count
            removedRules = @($removedRules)
            inheritedRulesConverted = $inheritedRulesConverted
            currentUserAccessAdded = $currentUserAccessAdded
        }
    }
    catch {
        if ($null -ne $_.Exception.Data -and $_.Exception.Data.Contains('MpwCode')) { throw }
        $diagnostic = Get-MpwExceptionDiagnosticDetails -ErrorRecord $_
        Throw-MpwFailure -Code 'FTP_ACL_TIGHTEN_FAILED' -Message 'Confirmed broad write-capable directory ACL rules could not be removed.' -Command 'DirectorySecurity.SetAccessRuleProtection/RemoveAccessRuleSpecific' -Details ([ordered]@{
            path = $path
            technicalMessage = [string]$diagnostic.technicalMessage
            sourceExceptionType = [string]$diagnostic.sourceExceptionType
            hresult = [string]$diagnostic.hresult
            acl = Get-MpwDirectoryAclDiagnostics -PhysicalPath $path
        })
    }
}

function Remove-MpwExplicitDirectoryAccess {
    param(
        [Parameter(Mandatory = $true)][string]$PhysicalPath,
        [Parameter(Mandatory = $true)][string]$Username
    )

    if (-not [IO.Directory]::Exists($PhysicalPath)) {
        return
    }
    try {
        $sid = Get-MpwAccountSid -Username $Username
        $acl = [IO.Directory]::GetAccessControl($PhysicalPath)
        $explicit = @($acl.GetAccessRules($true, $false, [Security.Principal.SecurityIdentifier]) | Where-Object { $_.IdentityReference -eq $sid })
        foreach ($rule in $explicit) {
            [void]$acl.RemoveAccessRuleSpecific($rule)
        }
        [IO.Directory]::SetAccessControl($PhysicalPath, $acl)
    }
    catch {
        Throw-MpwFailure -Code 'FTP_ACL_FAILED' -Message 'The previous managed FTP account ACL could not be removed.'
    }
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
            read = $false
            write = $false
            correct = $false
            broadInheritedAccess = $null
            rules = @()
        }
    }

    try {
        $sid = $null
        try { $sid = Get-MpwAccountSid -Username $Username } catch {}
        $acl = [IO.Directory]::GetAccessControl($PhysicalPath)
        $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
        $modifyMask = [Security.AccessControl.FileSystemRights]::Modify
        $hasAllow = $false
        $hasDeny = $false
        if ($null -ne $sid) {
            foreach ($rule in $rules | Where-Object { $_.IdentityReference -eq $sid }) {
                $coversModify = (($rule.FileSystemRights -band $modifyMask) -eq $modifyMask)
                if ($coversModify -and $rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow) { $hasAllow = $true }
                if (($rule.FileSystemRights -band $modifyMask) -ne 0 -and $rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Deny) { $hasDeny = $true }
            }
        }
        $broad = @(Get-MpwBroadDirectoryWriteRules -Acl $acl)
        return [ordered]@{
            detection = 'available'
            path = $PhysicalPath
            exists = $true
            owner = [string]$acl.Owner
            protected = [bool]$acl.AreAccessRulesProtected
            readWriteAllowed = [bool]($hasAllow -and -not $hasDeny)
            read = [bool]($hasAllow -and -not $hasDeny)
            write = [bool]($hasAllow -and -not $hasDeny)
            correct = [bool]($hasAllow -and -not $hasDeny)
            broadInheritedAccess = $broad.Count -gt 0
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
            read = $null
            write = $null
            correct = $null
            broadInheritedAccess = $null
            rules = @()
            errorCode = 'FTP_ACL_STATUS_FAILED'
        }
    }
}

function Import-MpwIisAdministration {
    $dll = Join-Path $env:windir 'System32\inetsrv\Microsoft.Web.Administration.dll'
    if (-not [IO.File]::Exists($dll)) {
        Throw-MpwFailure -Code 'IIS_FTP_NOT_INSTALLED' -Message 'Microsoft.Web.Administration is not installed.'
    }
    try {
        [void][Reflection.Assembly]::LoadFrom($dll)
    }
    catch {
        Throw-MpwFailure -Code 'IIS_STATUS_CHECK_FAILED' -Message 'Microsoft.Web.Administration could not be loaded.'
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
        Throw-MpwFailure -Code 'IIS_FTP_NOT_INSTALLED' -Message 'The IIS applicationHost.config file is not installed.'
    }
    catch {
        Throw-MpwFailure -Code 'IIS_STATUS_CHECK_FAILED' -Message 'The IIS applicationHost.config file could not be read.'
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
        Throw-MpwFailure -Code 'IIS_STATUS_CHECK_FAILED' -Message 'IIS configuration could not be opened.'
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

function Set-MpwFtpBindings {
    param(
        [Parameter(Mandatory = $true)]$Site,
        [Parameter(Mandatory = $true)][string]$Binding
    )

    $existing = @($Site.Bindings | Where-Object { $_.Protocol -eq 'ftp' })
    foreach ($item in $existing) {
        [void]$Site.Bindings.Remove($item)
    }
    [void]$Site.Bindings.Add($Binding, 'ftp')
}

function Set-MpwFtpSiteConfiguration {
    param(
        [Parameter(Mandatory = $true)]$Manager,
        [Parameter(Mandatory = $true)]$Site,
        [Parameter(Mandatory = $true)][string]$PhysicalPath,
        [Parameter(Mandatory = $true)][string]$Username,
        [Parameter(Mandatory = $true)][string]$Binding
    )

    $rootApplication = $Site.Applications['/']
    if ($null -eq $rootApplication) {
        Throw-MpwFailure -Code 'IIS_CONFIG_FAILED' -Message 'The IIS FTP site has no root application.'
    }
    $rootVirtualDirectory = $rootApplication.VirtualDirectories['/']
    if ($null -eq $rootVirtualDirectory) {
        Throw-MpwFailure -Code 'IIS_CONFIG_FAILED' -Message 'The IIS FTP site has no root virtual directory.'
    }

    Set-MpwFtpBindings -Site $Site -Binding $Binding
    $rootVirtualDirectory.PhysicalPath = $PhysicalPath
    $ftpServer = Get-MpwFtpSiteElement -Site $Site
    $security = $ftpServer.GetChildElement('security')
    $authentication = $security.GetChildElement('authentication')
    $authentication.GetChildElement('anonymousAuthentication')['enabled'] = $false
    $authentication.GetChildElement('basicAuthentication')['enabled'] = $true
    $ssl = $security.GetChildElement('ssl')
    $ssl['controlChannelPolicy'] = 'SslAllow'
    $ssl['dataChannelPolicy'] = 'SslAllow'
    $authorization = Get-MpwFtpAuthorizationSection -Manager $Manager -SiteName ([string]$Site.Name)
    $authorizationCollection = $authorization.GetCollection()
    # Never clear unrelated authorization rules on an explicitly adopted
    # site. Only replace rules for the managed username; rollback still keeps
    # an exact snapshot of the full collection.
    foreach ($existingRule in @($authorizationCollection | Where-Object { [string]$_['users'] -eq $Username })) {
        [void]$authorizationCollection.Remove($existingRule)
    }
    $rule = $authorizationCollection.CreateElement('add')
    $rule['accessType'] = 'Allow'
    $rule['users'] = $Username
    $rule['roles'] = ''
    $rule['permissions'] = 'Read, Write'
    [void]$authorizationCollection.Add($rule)
    $ftpServer.GetChildElement('firewallSupport')['externalIp4Address'] = ''
    $ftpServer['serverAutoStart'] = $true
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

    if ($ManagedSiteId -le 0 -or [long]$Site.Id -ne $ManagedSiteId) { return $false }
    # Site ID is the persisted identity. A user may rename a site in IIS, so
    # name drift alone must be repairable instead of turning the managed site
    # into an unrelated/adoptable resource.
    if (@($Site.Bindings | Where-Object { $_.Protocol -eq 'ftp' }).Count -eq 0) { return $false }
    $account = Get-MpwLocalAccountStatus -Username $Username
    if ($account.isManaged -ne $true) { return $false }
    return $true
}

function Restore-MpwSiteSnapshot {
    param(
        [Parameter(Mandatory = $true)]$Manager,
        [Parameter(Mandatory = $true)]$Site,
        [Parameter(Mandatory = $true)]$Snapshot
    )

    $allFtpBindings = @($Site.Bindings | Where-Object { $_.Protocol -eq 'ftp' })
    foreach ($binding in $allFtpBindings) { [void]$Site.Bindings.Remove($binding) }
    foreach ($binding in @($Snapshot.bindings | Where-Object { $_.protocol -eq 'ftp' })) {
        [void]$Site.Bindings.Add([string]$binding.bindingInformation, 'ftp')
    }
    $Site.Applications['/'].VirtualDirectories['/'].PhysicalPath = [string]$Snapshot.physicalPath
    $ftpServer = Get-MpwFtpSiteElement -Site $Site
    $security = $ftpServer.GetChildElement('security')
    $authentication = $security.GetChildElement('authentication')
    $authentication.GetChildElement('anonymousAuthentication')['enabled'] = [bool]$Snapshot.authentication.anonymousEnabled
    $authentication.GetChildElement('basicAuthentication')['enabled'] = [bool]$Snapshot.authentication.basicEnabled
    $ssl = $security.GetChildElement('ssl')
    $ssl['controlChannelPolicy'] = [string]$Snapshot.ssl.controlChannelPolicy
    $ssl['dataChannelPolicy'] = [string]$Snapshot.ssl.dataChannelPolicy
    $authorization = Get-MpwFtpAuthorizationSection -Manager $Manager -SiteName ([string]$Site.Name)
    $authorizationCollection = $authorization.GetCollection()
    $authorizationCollection.Clear()
    foreach ($oldRule in @($Snapshot.authorization)) {
        $rule = $authorizationCollection.CreateElement('add')
        $rule['accessType'] = [string]$oldRule.accessType
        $rule['users'] = [string]$oldRule.users
        $rule['roles'] = [string]$oldRule.roles
        $rule['permissions'] = [string]$oldRule.permissions
        [void]$authorizationCollection.Add($rule)
    }
    $ftpServer.GetChildElement('firewallSupport')['externalIp4Address'] = [string]$Snapshot.externalIp4Address
    $ftpServer['serverAutoStart'] = [bool]$Snapshot.serverAutoStart
}

function Get-MpwGlobalPassivePorts {
    param([Parameter(Mandatory = $true)]$Manager)

    $section = $Manager.GetApplicationHostConfiguration().GetSection('system.ftpServer/firewallSupport')
    return [ordered]@{
        start = [int]$section['lowDataChannelPort']
        end = [int]$section['highDataChannelPort']
    }
}

function Set-MpwGlobalPassivePorts {
    param(
        [Parameter(Mandatory = $true)]$Manager,
        [Parameter(Mandatory = $true)][int]$Start,
        [Parameter(Mandatory = $true)][int]$End
    )

    $section = $Manager.GetApplicationHostConfiguration().GetSection('system.ftpServer/firewallSupport')
    $section['lowDataChannelPort'] = $Start
    $section['highDataChannelPort'] = $End
}

function Get-MpwFtpServiceStatus {
    try {
        $controller = Get-Service -Name FTPSVC -ErrorAction SilentlyContinue
        if ($null -eq $controller) {
            return [ordered]@{ exists = $false; name = 'FTPSVC'; state = $null; status = 'notFound'; startMode = $null; startType = 'unknown'; running = $false; processId = $null }
        }
        $cimService = $null
        try { $cimService = Get-CimInstance Win32_Service -Filter "Name='FTPSVC'" -ErrorAction Stop } catch {}
        $startType = 'unknown'
        try {
            $startValue = [int](Get-ItemPropertyValue -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Services\FTPSVC' -Name Start -ErrorAction Stop)
            $startType = switch ($startValue) { 2 { 'Auto' } 3 { 'Manual' } 4 { 'Disabled' } default { 'unknown' } }
        }
        catch {}
        $state = [string]$controller.Status
        return [ordered]@{
            exists = $true
            name = [string]$controller.Name
            displayName = [string]$controller.DisplayName
            state = $state
            status = $state
            startMode = $startType
            startType = $startType
            running = $controller.Status -eq [ServiceProcess.ServiceControllerStatus]::Running
            processId = if ($null -ne $cimService) { [int]$cimService.ProcessId } else { $null }
        }
    }
    catch {
        return [ordered]@{ exists = $null; name = 'FTPSVC'; state = 'unknown'; status = 'unknown'; startMode = $null; startType = 'unknown'; running = $null; processId = $null; errorCode = 'IIS_SERVICE_STATUS_FAILED' }
    }
}

function Start-MpwFtpService {
    $service = Get-Service -Name FTPSVC -ErrorAction SilentlyContinue
    if ($null -eq $service) {
        Throw-MpwFailure -Code 'IIS_SERVICE_NOT_FOUND' -Message 'Microsoft FTP Service was not found.'
    }
    try {
        Set-Service -Name FTPSVC -StartupType Automatic -ErrorAction Stop
        if ($service.Status -ne [ServiceProcess.ServiceControllerStatus]::Running) {
            Start-Service -Name FTPSVC -ErrorAction Stop
        }
        $service = Get-Service -Name FTPSVC -ErrorAction Stop
        if ($service.Status -ne [ServiceProcess.ServiceControllerStatus]::Running) {
            $service.WaitForStatus([ServiceProcess.ServiceControllerStatus]::Running, [TimeSpan]::FromSeconds(10))
            $service.Refresh()
        }
        if ($service.Status -ne [ServiceProcess.ServiceControllerStatus]::Running) {
            Throw-MpwFailure -Code 'IIS_FTP_SERVICE_START_FAILED' -Message 'Microsoft FTP Service did not reach the Running state.' -Command 'Start-Service FTPSVC' -Details ([ordered]@{
                serviceName = 'FTPSVC'
                serviceState = [string]$service.Status
                technicalMessage = 'FTPSVC did not reach the Running state within 10 seconds.'
            })
        }
    }
    catch {
        if ($_.Exception.Data.Contains('MpwCode')) { throw }
        $diagnostic = Get-MpwExceptionDiagnosticDetails -ErrorRecord $_
        $serviceAfter = Get-MpwFtpServiceStatus
        Throw-MpwFailure -Code 'IIS_FTP_SERVICE_START_FAILED' -Message 'Microsoft FTP Service could not be started.' -Command 'Start-Service FTPSVC' -Details ([ordered]@{
            serviceName = 'FTPSVC'
            serviceState = [string]$serviceAfter.state
            serviceStartType = [string]$serviceAfter.startType
            technicalMessage = [string]$diagnostic.technicalMessage
            innerTechnicalMessage = [string]$diagnostic.innerTechnicalMessage
            sourceExceptionType = [string]$diagnostic.sourceExceptionType
            hresult = [string]$diagnostic.hresult
        })
    }
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

function Restore-MpwFtpServiceSnapshot {
    param(
        [AllowNull()]$Snapshot,
        [AllowNull()]$Manager = $null,
        [long]$TargetSiteId = 0,
        [AllowNull()][string]$TargetSiteName = $null
    )

    $warnings = [Collections.Generic.List[object]]::new()
    $otherStartedSites = @()
    $siteInspectionSucceeded = $true
    try {
        if ($null -eq $Manager) {
            $siteInspectionSucceeded = $false
        }
        else {
            $otherFtpSites = @(Get-MpwFtpSites -Manager $Manager | Where-Object {
                -not ($TargetSiteId -gt 0 -and [long]$_.id -eq $TargetSiteId) -and
                -not ($TargetSiteId -le 0 -and -not [string]::IsNullOrWhiteSpace($TargetSiteName) -and [string]$_.name -eq $TargetSiteName)
            })
            $unknownStateSites = @($otherFtpSites | Where-Object { [string]$_.state -ne 'Started' -and [string]$_.state -ne 'Stopped' })
            if ($unknownStateSites.Count -gt 0) {
                $siteInspectionSucceeded = $false
                [void]$warnings.Add([ordered]@{
                    code = 'FTPSVC_ROLLBACK_SITE_STATE_UNKNOWN'
                    message = 'At least one unrelated IIS FTP site has an unknown runtime state, so FTPSVC will not be stopped during rollback.'
                    sites = @($unknownStateSites | ForEach-Object { [ordered]@{ id = [long]$_.id; name = [string]$_.name; state = [string]$_.state } })
                })
            }
            $otherStartedSites = @($otherFtpSites | Where-Object { [string]$_.state -eq 'Started' } | ForEach-Object {
                [ordered]@{ id = [long]$_.id; name = [string]$_.name; state = [string]$_.state }
            })
        }
    }
    catch {
        $siteInspectionSucceeded = $false
        [void]$warnings.Add([ordered]@{
            code = 'FTPSVC_ROLLBACK_SITE_INSPECTION_FAILED'
            message = 'Other IIS FTP sites could not be inspected, so FTPSVC will not be stopped during rollback.'
            technicalMessage = [string]$_.Exception.Message
        })
    }

    $currentStatus = Get-MpwFtpServiceStatus
    $decision = Get-MpwFtpServiceRollbackDecision -Snapshot $Snapshot -CurrentStatus $currentStatus -OtherStartedSites $otherStartedSites -SiteInspectionSucceeded $siteInspectionSucceeded
    $startupTypeRestored = $false
    $runningStateRestored = $false

    if ($decision.startupTypeRestorable) {
        try {
            Set-Service -Name FTPSVC -StartupType ([string]$decision.startupType) -ErrorAction Stop
            $startupTypeRestored = $true
        }
        catch {
            [void]$warnings.Add([ordered]@{
                code = 'FTPSVC_STARTUP_TYPE_ROLLBACK_FAILED'
                message = 'The original Microsoft FTP Service startup type could not be restored.'
                technicalMessage = [string]$_.Exception.Message
            })
        }
    }
    else {
        [void]$warnings.Add([ordered]@{
            code = 'FTPSVC_STARTUP_TYPE_SNAPSHOT_UNAVAILABLE'
            message = 'The original Microsoft FTP Service startup type was unavailable and could not be restored.'
        })
    }

    switch ([string]$decision.runningStateAction) {
        'not_required' { $runningStateRestored = $true }
        'start' {
            try {
                Start-Service -Name FTPSVC -ErrorAction Stop
                $controller = Get-Service -Name FTPSVC -ErrorAction Stop
                if ($controller.Status -ne [ServiceProcess.ServiceControllerStatus]::Running) {
                    $controller.WaitForStatus([ServiceProcess.ServiceControllerStatus]::Running, [TimeSpan]::FromSeconds(10))
                    $controller.Refresh()
                }
                $runningStateRestored = $controller.Status -eq [ServiceProcess.ServiceControllerStatus]::Running
                if (-not $runningStateRestored) { throw 'FTPSVC did not reach its original Running state.' }
            }
            catch {
                [void]$warnings.Add([ordered]@{
                    code = 'FTPSVC_RUNNING_STATE_ROLLBACK_FAILED'
                    message = 'Microsoft FTP Service could not be returned to its original Running state.'
                    technicalMessage = [string]$_.Exception.Message
                })
            }
        }
        'stop' {
            try {
                Stop-Service -Name FTPSVC -ErrorAction Stop
                $controller = Get-Service -Name FTPSVC -ErrorAction Stop
                if ($controller.Status -ne [ServiceProcess.ServiceControllerStatus]::Stopped) {
                    $controller.WaitForStatus([ServiceProcess.ServiceControllerStatus]::Stopped, [TimeSpan]::FromSeconds(10))
                    $controller.Refresh()
                }
                $runningStateRestored = $controller.Status -eq [ServiceProcess.ServiceControllerStatus]::Stopped
                if (-not $runningStateRestored) { throw 'FTPSVC did not reach its original Stopped state.' }
            }
            catch {
                [void]$warnings.Add([ordered]@{
                    code = 'FTPSVC_RUNNING_STATE_ROLLBACK_FAILED'
                    message = 'Microsoft FTP Service could not be returned to its original Stopped state.'
                    technicalMessage = [string]$_.Exception.Message
                })
            }
        }
        default {
            [void]$warnings.Add([ordered]@{
                code = 'FTPSVC_RUNNING_STATE_ROLLBACK_SKIPPED'
                message = if ($decision.runningStateReason -eq 'OTHER_FTP_SITES_RUNNING') { 'FTPSVC remains running because another IIS FTP site is currently started.' } else { 'FTPSVC running-state rollback was skipped because it could not be proven safe.' }
                reason = [string]$decision.runningStateReason
                otherStartedSites = @($decision.otherStartedSites)
            })
        }
    }

    return [ordered]@{
        attempted = $true
        startupTypeRestored = $startupTypeRestored
        runningStateRestored = $runningStateRestored
        runningStateAction = [string]$decision.runningStateAction
        runningStateReason = [string]$decision.runningStateReason
        otherStartedSites = @($decision.otherStartedSites)
        warnings = @($warnings)
        succeeded = $warnings.Count -eq 0
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

function Get-MpwPortStatus {
    param(
        [Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$Port,
        [Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$PassiveStart,
        [Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$PassiveEnd
    )

    $listeners = @()
    try {
        $connections = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop)
    }
    catch {
        $connections = @()
    }
    $ftpService = Get-MpwFtpServiceStatus
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
    $availablePorts = @(Get-MpwAvailableControlPorts -PreferredPort 21 -PassiveStart $PassiveStart -PassiveEnd $PassiveEnd -Count 5)
    return [ordered]@{
        configuredPort = $Port
        listening = $listeners.Count -gt 0
        listeners = @($listeners)
        usedByOtherProcess = if (@($listeners | Where-Object { $_.isMicrosoftFtpService -eq $false }).Count -gt 0) { $true } elseif (@($listeners | Where-Object { $null -eq $_.isMicrosoftFtpService }).Count -gt 0) { $null } else { $false }
        pid = if ($listeners.Count -gt 0) { [int]$listeners[0].pid } else { $null }
        processName = if ($listeners.Count -gt 0) { [string]$listeners[0].processName } else { '' }
        ownedByMicrosoftFtp = if ($listeners.Count -gt 0) { $listeners[0].isMicrosoftFtpService } else { $false }
        conflict = if (@($listeners | Where-Object { $_.isMicrosoftFtpService -eq $false }).Count -gt 0) { $true } elseif (@($listeners | Where-Object { $null -eq $_.isMicrosoftFtpService }).Count -gt 0) { $null } else { $false }
        reserved = [bool]$reservation.reserved
        reservedRange = [string]$reservation.range
        iisSiteName = ''
        iisSiteNames = @()
        ownedByManagedSite = $null
        adoptable = $null
        canChangePort = $true
        availablePorts = $availablePorts
        recommendation = if ($availablePorts.Count -gt 0) { "Use available control port $($availablePorts[0]) after confirmation." } else { 'No available control port was found.' }
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

function Test-MpwFirewallValue {
    param(
        [AllowNull()]$Actual,
        [Parameter(Mandatory = $true)][string]$Expected
    )
    $values = @($Actual | ForEach-Object { [string]$_ })
    return $values.Count -eq 1 -and $values[0] -ieq $Expected
}

function Test-MpwFirewallRuleMatchesTarget {
    param(
        [Parameter(Mandatory = $true)]$Snapshot,
        [Parameter(Mandatory = $true)][string]$DisplayName,
        [Parameter(Mandatory = $true)][string]$LocalPort
    )
    return [bool](
        [string]$Snapshot.displayName -eq $DisplayName -and
        [bool]$Snapshot.enabled -and
        [string]$Snapshot.direction -eq 'Inbound' -and
        [string]$Snapshot.action -eq 'Allow' -and
        [string]$Snapshot.profile -eq 'Any' -and
        (Test-MpwFirewallValue -Actual $Snapshot.protocol -Expected 'TCP') -and
        (Test-MpwFirewallValue -Actual $Snapshot.localPort -Expected $LocalPort) -and
        (Test-MpwFirewallValue -Actual $Snapshot.remotePort -Expected 'Any') -and
        (Test-MpwFirewallValue -Actual $Snapshot.localAddress -Expected 'Any') -and
        (Test-MpwFirewallValue -Actual $Snapshot.remoteAddress -Expected 'LocalSubnet')
    )
}

function New-MpwFirewallRuleChangeModel {
    param(
        [Parameter(Mandatory = $true)][ValidateSet('control', 'passive')][string]$Kind,
        [Parameter(Mandatory = $true)]$Snapshot,
        [Parameter(Mandatory = $true)][string]$DisplayName,
        [Parameter(Mandatory = $true)][string]$LocalPort
    )
    return [ordered]@{
        kind = $Kind
        internalName = [string]$Snapshot.internalName
        policyStoreSourceType = [string]$Snapshot.policyStoreSourceType
        current = [ordered]@{
            displayName = [string]$Snapshot.displayName
            enabled = [bool]$Snapshot.enabled
            direction = [string]$Snapshot.direction
            action = [string]$Snapshot.action
            profile = [string]$Snapshot.profile
            protocol = [string]$Snapshot.protocol
            localPort = @($Snapshot.localPort) -join ','
            localAddress = @($Snapshot.localAddress) -join ','
            remoteAddress = @($Snapshot.remoteAddress) -join ','
        }
        target = [ordered]@{
            displayName = $DisplayName
            enabled = $true
            direction = 'Inbound'
            action = 'Allow'
            profile = 'Any'
            protocol = 'TCP'
            localPort = $LocalPort
            localAddress = 'Any'
            remoteAddress = 'LocalSubnet'
        }
    }
}

function Assert-MpwFirewallRuleUpdatesAllowed {
    param([Parameter(Mandatory = $true)]$Options)

    $changes = [Collections.Generic.List[object]]::new()
    foreach ($spec in @(
        [ordered]@{ kind = 'control'; displayName = $Options.FirewallControlRuleName; localPort = [string]$Options.ControlPort },
        [ordered]@{ kind = 'passive'; displayName = $Options.FirewallPassiveRuleName; localPort = "$($Options.PassivePortStart)-$($Options.PassivePortEnd)" }
    )) {
        $selection = Get-MpwFirewallRuleSelection -Kind $spec.kind -DisplayName $spec.displayName
        if ($null -eq $selection.rule) { continue }
        $snapshot = Get-MpwFirewallRuleSnapshot -Rule $selection.rule
        if (Test-MpwFirewallRuleMatchesTarget -Snapshot $snapshot -DisplayName $spec.displayName -LocalPort $spec.localPort) { continue }

        if ([string]$snapshot.policyStoreSourceType -ne 'Local') {
            Throw-MpwFailure -Code 'FIREWALL_RULE_POLICY_BLOCKED' -Message 'An FTP firewall rule is controlled by Windows policy and cannot be changed by Media Photo Workbench.' -Details ([ordered]@{
                source = 'policyFirewallRule'
                kind = $spec.kind
                internalName = [string]$snapshot.internalName
                displayName = [string]$snapshot.displayName
                policyStoreSourceType = [string]$snapshot.policyStoreSourceType
                recommendation = 'Ask the Windows administrator to update the policy-owned rule or create a dedicated local rule.'
            })
        }
        if (-not [bool]$selection.managed) {
            [void]$changes.Add((New-MpwFirewallRuleChangeModel -Kind $spec.kind -Snapshot $snapshot -DisplayName $spec.displayName -LocalPort $spec.localPort))
        }
    }

    if ($changes.Count -gt 0 -and -not [bool]$Options.AllowLegacyFirewallRuleUpdate) {
        Throw-MpwFailure -Code 'FIREWALL_RULE_UPDATE_CONFIRMATION_REQUIRED' -Message 'Legacy local FTP firewall rules require explicit confirmation before they can be updated.' -Details ([ordered]@{
            source = 'legacyFirewallRules'
            riskLevel = 'high'
            canConfirm = $true
            changes = @($changes)
            recommendation = 'Review the exact local firewall rule changes and confirm them in Media Photo Workbench.'
        })
    }
}

function Restore-MpwFirewallRuleSnapshot {
    param([Parameter(Mandatory = $true)]$Snapshot)

    $parameters = @{
        Name = [string]$Snapshot.internalName
        NewDisplayName = [string]$Snapshot.displayName
        # Set-NetFirewallRule binds Enabled to the NetSecurity.Enabled enum.
        # A Boolean from the JSON snapshot is not accepted on some Windows 11
        # builds, while the enum names are stable across those builds.
        Enabled = if ([bool]$Snapshot.enabled) { 'True' } else { 'False' }
        Direction = [string]$Snapshot.direction
        Action = [string]$Snapshot.action
        Profile = [string]$Snapshot.profile
        Protocol = [string]$Snapshot.protocol
        LocalPort = @($Snapshot.localPort)
        RemotePort = @($Snapshot.remotePort)
        LocalAddress = @($Snapshot.localAddress)
        RemoteAddress = @($Snapshot.remoteAddress)
        ErrorAction = 'Stop'
    }
    [void](Set-NetFirewallRule @parameters)

    $restoredRule = Get-NetFirewallRule -Name ([string]$Snapshot.internalName) -ErrorAction Stop
    $restored = Get-MpwFirewallRuleSnapshot -Rule $restoredRule
    $mismatches = [Collections.Generic.List[string]]::new()
    foreach ($field in @('displayName', 'enabled', 'direction', 'action', 'profile', 'protocol', 'localPort', 'remotePort', 'localAddress', 'remoteAddress')) {
        $expectedValues = @((Get-MpwInputValue -InputObject $Snapshot -Name $field -DefaultValue $null) | ForEach-Object { [string]$_ } | Sort-Object)
        $actualValues = @((Get-MpwInputValue -InputObject $restored -Name $field -DefaultValue $null) | ForEach-Object { [string]$_ } | Sort-Object)
        if ([string]::Join('|', $expectedValues) -ine [string]::Join('|', $actualValues)) {
            [void]$mismatches.Add($field)
        }
    }
    if ($mismatches.Count -gt 0) {
        Throw-MpwFailure -Code 'FIREWALL_ROLLBACK_VERIFY_FAILED' -Message 'The Windows Firewall FTP rule snapshot was applied but did not pass rollback verification.' -Command 'Set-NetFirewallRule/Get-NetFirewallRule' -Details ([ordered]@{
            internalName = [string]$Snapshot.internalName
            failedFields = @($mismatches)
            expected = $Snapshot
            actual = $restored
            technicalMessage = "Firewall rollback verification mismatched: $([string]::Join(', ', @($mismatches)))."
        })
    }
    return [ordered]@{ succeeded = $true; internalName = [string]$Snapshot.internalName; verifiedFields = @('displayName', 'enabled', 'direction', 'action', 'profile', 'protocol', 'localPort', 'remotePort', 'localAddress', 'remoteAddress') }
}

function Ensure-MpwFirewallRule {
    param(
        [Parameter(Mandatory = $true)][ValidateSet('control', 'passive')][string]$Kind,
        [Parameter(Mandatory = $true)][string]$DisplayName,
        [Parameter(Mandatory = $true)][string]$LocalPort,
        [bool]$AllowLegacyRuleUpdate = $false
    )

    $internalName = if ($Kind -eq 'control') { $script:MpwControlFirewallInternalName } else { $script:MpwPassiveFirewallInternalName }
    $selection = Get-MpwFirewallRuleSelection -Kind $Kind -DisplayName $DisplayName
    if ($null -eq $selection.rule) {
        try {
            [void](New-NetFirewallRule -Name $internalName -DisplayName $DisplayName -Direction Inbound -Action Allow -Enabled True -Profile Any -Protocol TCP -LocalPort $LocalPort -LocalAddress Any -RemoteAddress LocalSubnet -ErrorAction Stop)
            return [ordered]@{ internalName = $internalName; created = $true; modified = $false }
        }
        catch {
            Throw-MpwFailure -Code 'FIREWALL_CONFIG_FAILED' -Message 'The dedicated Windows Firewall FTP rule could not be created.' -Command 'New-NetFirewallRule' -Details ([ordered]@{
                kind = $Kind
                internalName = $internalName
                localPort = $LocalPort
                technicalMessage = [string]$_.Exception.Message
            })
        }
    }

    $ruleName = [string]$selection.rule.Name
    $snapshot = Get-MpwFirewallRuleSnapshot -Rule $selection.rule
    if (Test-MpwFirewallRuleMatchesTarget -Snapshot $snapshot -DisplayName $DisplayName -LocalPort $LocalPort) {
        return [ordered]@{ internalName = $ruleName; created = $false; modified = $false; adoptedLegacy = -not [bool]$selection.managed }
    }
    if ([string]$snapshot.policyStoreSourceType -ne 'Local') {
        Throw-MpwFailure -Code 'FIREWALL_RULE_POLICY_BLOCKED' -Message 'The FTP firewall rule is controlled by Windows policy and cannot be changed automatically.' -Details ([ordered]@{
            source = 'policyFirewallRule'
            kind = $Kind
            internalName = $ruleName
            displayName = [string]$snapshot.displayName
            policyStoreSourceType = [string]$snapshot.policyStoreSourceType
        })
    }
    if (-not [bool]$selection.managed -and -not $AllowLegacyRuleUpdate) {
        Throw-MpwFailure -Code 'FIREWALL_RULE_UPDATE_CONFIRMATION_REQUIRED' -Message 'The legacy local FTP firewall rule requires explicit confirmation before it can be updated.' -Details ([ordered]@{
            source = 'legacyFirewallRules'
            riskLevel = 'high'
            canConfirm = $true
            changes = @((New-MpwFirewallRuleChangeModel -Kind $Kind -Snapshot $snapshot -DisplayName $DisplayName -LocalPort $LocalPort))
        })
    }

    try {
        [void](Set-NetFirewallRule -Name $ruleName -NewDisplayName $DisplayName -Enabled True -Direction Inbound -Action Allow -Profile Any -Protocol TCP -LocalPort $LocalPort -RemotePort Any -LocalAddress Any -RemoteAddress LocalSubnet -ErrorAction Stop)
        return [ordered]@{ internalName = $ruleName; created = $false; modified = $true; adoptedLegacy = -not [bool]$selection.managed; previousSnapshot = $snapshot }
    }
    catch {
        $mutationMessage = [string]$_.Exception.Message
        $restoreMessage = ''
        try { Restore-MpwFirewallRuleSnapshot -Snapshot $snapshot } catch { $restoreMessage = [string]$_.Exception.Message }
        Throw-MpwFailure -Code 'FIREWALL_CONFIG_FAILED' -Message 'The Windows Firewall FTP rule could not be updated; the previous rule was restored when possible.' -Command 'Set-NetFirewallRule' -Details ([ordered]@{
            kind = $Kind
            internalName = $ruleName
            localPort = $LocalPort
            policyStoreSourceType = [string]$snapshot.policyStoreSourceType
            technicalMessage = $mutationMessage
            rollbackTechnicalMessage = $restoreMessage
        })
    }
}

function Restore-MpwFirewallRuleChange {
    param([AllowNull()]$Result)
    if ($null -eq $Result) { return }
    if ([bool]$Result.created) {
        Remove-NetFirewallRule -Name ([string]$Result.internalName) -ErrorAction Stop
        return
    }
    if ([bool]$Result.modified -and $null -ne $Result.previousSnapshot) {
        Restore-MpwFirewallRuleSnapshot -Snapshot $Result.previousSnapshot
    }
}

function Get-MpwWindowsFeaturesStatus {
    $names = @('IIS-FTPServer', 'IIS-FTPSvc', 'IIS-FTPExtensibility', 'IIS-ManagementScriptingTools')
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
            $features += [ordered]@{ featureName = $name; state = 'unknown'; installedHint = $null; requiresAdmin = $true; errorCode = 'WINDOWS_FEATURE_STATUS_FAILED' }
        }
    }
    return @($features)
}

function Enable-MpwRequiredWindowsFeatures {
    $names = @('IIS-FTPServer', 'IIS-FTPSvc', 'IIS-FTPExtensibility', 'IIS-ManagementScriptingTools')
    $enabled = @()
    $restartRequired = $false
    $restartFeature = $null
    $processed = @()
    foreach ($name in $names) {
        try {
            $feature = Get-WindowsOptionalFeature -Online -FeatureName $name -ErrorAction Stop
            $processed += $name
            if ([string]$feature.State -ne 'Enabled') {
                $result = Enable-WindowsOptionalFeature -Online -FeatureName $name -All -NoRestart -ErrorAction Stop
                $enabled += $name
                if ([bool]$result.RestartNeeded) {
                    $restartRequired = $true
                    $restartFeature = $name
                    break
                }
            }
        }
        catch {
            Throw-MpwFailure -Code 'IIS_FTP_INSTALL_FAILED' -Message 'A required Windows IIS FTP feature could not be enabled.'
        }
    }
    return [ordered]@{
        enabledFeatures = @($enabled)
        processedFeatures = @($processed)
        remainingFeatures = @($names | Where-Object { $processed -notcontains $_ })
        restartRequired = $restartRequired
        restartFeature = $restartFeature
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
        [int]$TimeoutMilliseconds = 10000
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
            technicalMessage = "The FTP site runtime state remained '$state' after 10 seconds."
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
            technicalMessage = "The FTP site runtime state remained '$state' after 10 seconds."
        })
    }
}

function Wait-MpwPortListener {
    param(
        [Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$Port,
        [Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$PassiveStart,
        [Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$PassiveEnd,
        [int]$TimeoutMilliseconds = 5000
    )

    $deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMilliseconds)
    do {
        $status = Get-MpwPortStatus -Port $Port -PassiveStart $PassiveStart -PassiveEnd $PassiveEnd
        if ($status.listening) { return $status }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)
    return Get-MpwPortStatus -Port $Port -PassiveStart $PassiveStart -PassiveEnd $PassiveEnd
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
        $account = Get-MpwLocalAccountStatus -Username $Options.Username
        $port = Get-MpwPortStatus -Port $Options.ControlPort -PassiveStart $Options.PassivePortStart -PassiveEnd $Options.PassivePortEnd
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
        $authorizationCorrect = [bool]($authorizationRead -and $authorizationWrite)
        $siteId = if ($siteExists) { [long]$siteIdentity.id } else { $null }
        $siteIdMatches = [bool]($siteExists -and $Options.ManagedSiteId -gt 0 -and $siteId -eq $Options.ManagedSiteId)
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
            [void]$conflictItems.Add([ordered]@{ type = 'site'; code = 'IIS_SITE_PORT_CONFLICT'; message = 'Another IIS FTP site uses the configured control port. Choose another port or explicitly adopt the exact Site ID.'; siteName = [string]$otherSite.name; physicalPath = [string]$otherSite.physicalPath; binding = if ($null -ne $otherBinding) { [string]$otherBinding.bindingInformation } else { '' }; port = $Options.ControlPort; status = [string]$otherSite.state; adoptable = $true; verifiedWithNikon = $verifiedTestSite; canChangePort = $true; availablePorts = @($port.availablePorts); recommendation = 'Choose an available port, or explicitly confirm this exact Site ID for adoption.' })
        }
        if ($port.reserved) { [void]$conflictItems.Add([ordered]@{ type = 'port'; code = 'FTP_CONTROL_PORT_RESERVED'; message = 'The configured control port is reserved by Windows.'; port = $Options.ControlPort; source = 'windowsReservedPort'; adoptable = $false; canChangePort = $true; availablePorts = @($port.availablePorts); recommendation = 'Choose one of the available control ports.' }) }
        if ($port.conflict) { [void]$conflictItems.Add([ordered]@{ type = 'port'; code = 'PORT_USED_BY_OTHER_PROCESS'; message = 'The configured control port is owned by another process.'; port = $Options.ControlPort; pid = $port.pid; processName = [string]$port.processName; source = 'process'; adoptable = $false; canChangePort = $true; availablePorts = @($port.availablePorts); recommendation = 'Do not stop the other process automatically. Choose another available control port.' }) }
        if ($account.conflict) { [void]$conflictItems.Add([ordered]@{ type = 'user'; code = 'FTP_ACCOUNT_CONFLICT'; message = 'The configured username is not a Media Photo Workbench managed account.'; adoptable = $false }) }
        $warnings = [Collections.Generic.List[string]]::new()
        if ($sameNameOwnershipConflict) {
            [void]$warnings.Add((if ($sameNameIdConflict) { 'The configured IIS site identity does not match managedSiteId and requires explicit adoption.' } elseif (-not $siteIsFtp) { 'The configured IIS site has no FTP binding and requires explicit adoption.' } else { 'The configured IIS site account marker is not managed and requires explicit adoption.' }))
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

        return [ordered]@{
            provider = 'iis'
            platform = [ordered]@{ isWindows = $true; isWindows11 = [Environment]::OSVersion.Version.Build -ge 22000; supported = [Environment]::OSVersion.Version.Build -ge 22000; version = [Environment]::OSVersion.Version.ToString() }
            windowsFeatures = [ordered]@{ ftpService = $ftpServiceFeature; ftpExtensibility = $ftpExtensibilityFeature; managementTools = $managementFeature }
            service = $service
            site = [ordered]@{ id = $siteId; exists = $siteExists; name = $resolvedSiteName; status = if ($siteExists) { [string]$siteIdentity.state } else { 'notFound' }; started = [bool]($siteExists -and [string]$siteIdentity.state -eq 'Started'); physicalPath = if ($siteExists) { [string]$siteIdentity.physicalPath } else { '' }; binding = $bindingValue; controlPort = $Options.ControlPort; sslEnabled = $sslEnabled; adoptable = $sameNameOwnershipConflict; managed = $siteManaged }
            binding = [ordered]@{ value = $bindingValue; host = $bindingHost; port = $Options.ControlPort; allUnassigned = $bindingCorrect; correct = $bindingCorrect }
            authentication = [ordered]@{ basicEnabled = $basicEnabled; anonymousEnabled = $anonymousEnabled; correct = $authCorrect }
            authorization = [ordered]@{ configured = $null -ne $authorizationRule; username = $Options.Username; read = $authorizationRead; write = $authorizationWrite; correct = $authorizationCorrect }
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
