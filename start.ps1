$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$folioNodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($folioNodeCommand) {
    & $folioNodeCommand.Source --experimental-strip-types server.ts
} else {
    $folioBundledNode = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
    if (Test-Path -LiteralPath $folioBundledNode) {
        & $folioBundledNode --experimental-strip-types server.ts
    } else {
        throw 'Please install Node.js 24 or later, then run npm start.'
    }
}
