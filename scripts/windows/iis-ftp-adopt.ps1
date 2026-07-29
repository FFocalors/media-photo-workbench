param(
    [string]$InputPath,
    [string]$OutputPath,
    [string]$StatusPath,
    [string]$OperationId
)

# Compatibility entrypoint retained for older packages and diagnostics.
# Adoption now uses the same preflight, restart gate, authorization checks,
# transaction snapshot and verified rollback path as setup/repair. Keeping a
# second provisioning implementation caused the two scripts to drift.
function Invoke-MpwIisFtpAdopt {
    param(
        [Parameter(Mandatory = $true)][string]$InputPath,
        [Parameter(Mandatory = $true)][string]$OutputPath,
        [AllowNull()][string]$StatusPath = $null,
        [AllowNull()][string]$OperationId = $null
    )

    $setupPath = Join-Path $PSScriptRoot 'iis-ftp-setup.ps1'
    . $setupPath `
        -InputPath $InputPath `
        -OutputPath $OutputPath `
        -StatusPath $StatusPath `
        -OperationId $OperationId
    return Invoke-MpwIisFtpSetup -InputPath $InputPath -OutputPath $OutputPath
}

if ($MyInvocation.InvocationName -ne '.') {
    exit (Invoke-MpwIisFtpAdopt `
        -InputPath $InputPath `
        -OutputPath $OutputPath `
        -StatusPath $StatusPath `
        -OperationId $OperationId)
}
