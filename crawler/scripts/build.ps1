$ErrorActionPreference = "Stop"

$crawlerRoot = Resolve-Path "$PSScriptRoot/.."

Write-Host "Building backend..."
Set-Location "$crawlerRoot/backend"
go test ./...

Write-Host "Building frontend..."
Set-Location "$crawlerRoot/frontend"
npm run build

Write-Host "Build completed."
