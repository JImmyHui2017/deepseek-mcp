param([Parameter(Mandatory = $true)][string]$ConfigPath)
$ErrorActionPreference = 'Stop'
try {
    $configuration = Get-Content -Raw -LiteralPath $ConfigPath | ConvertFrom-Json
    $secret = ConvertTo-SecureString -String $configuration.api_key_dpapi
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    try {
        [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer))
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
        $secret.Dispose()
    }
} catch {
    [Console]::Error.WriteLine('Could not decrypt the DeepSeek key for this Windows user.')
    exit 1
}
