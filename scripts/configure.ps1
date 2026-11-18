$ErrorActionPreference = 'Stop'
$env:PSModulePath = Join-Path $PSHOME 'Modules'
$configurationPath = if ($env:DEEPSEEK_MCP_CONFIG) { $env:DEEPSEEK_MCP_CONFIG } else { Join-Path $env:APPDATA 'deepseek-search-mcp\config.json' }
Write-Host 'Enter your official DeepSeek API key. Input is hidden.'
$secret = Read-Host -Prompt 'DeepSeek API key' -AsSecureString
try {
    if ($secret.Length -eq 0) { throw 'No API key entered.' }
    $encrypted = ConvertFrom-SecureString -SecureString $secret
    $directory = Split-Path -Parent $configurationPath
    [IO.Directory]::CreateDirectory($directory) | Out-Null
    $configuration = @{ version = 1; api_key_dpapi = $encrypted } | ConvertTo-Json
    $temporaryPath = Join-Path $directory ([IO.Path]::GetRandomFileName())
    try {
        [IO.File]::WriteAllText($temporaryPath, $configuration, (New-Object Text.UTF8Encoding($false)))
        Move-Item -LiteralPath $temporaryPath -Destination $configurationPath -Force
    } finally {
        if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath }
    }
    Write-Host "Saved with Windows user encryption: $configurationPath"
    Write-Host 'All registered agents under this Windows user will read the same key.'
    Write-Host 'An existing DEEPSEEK_API_KEY environment variable takes precedence.'
    $env:DEEPSEEK_MCP_CONFIG = $configurationPath
    & node (Join-Path $PSScriptRoot 'check-live.mjs')
    exit $LASTEXITCODE
} finally {
    $secret.Dispose()
}
