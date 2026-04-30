$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path "$PSScriptRoot/../.."

Write-Host "Building backend..."
Set-Location $repoRoot
go test ./crawler/backend/...

Write-Host "Building frontend..."
Set-Location "$repoRoot/crawler/frontend"
npm run build

Write-Host "Build completed."
