$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Instale Node.js 22.18 ou superior.' }
if (-not (Test-Path -LiteralPath 'node_modules')) {
    & npm.cmd ci --ignore-scripts
    if ($LASTEXITCODE -ne 0) { throw 'Não foi possível instalar as dependências.' }
}
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível preparar o painel.' }
Write-Host 'Abra o endereço indicado pela aplicação abaixo para acessar sua conta.'
& npm.cmd start
