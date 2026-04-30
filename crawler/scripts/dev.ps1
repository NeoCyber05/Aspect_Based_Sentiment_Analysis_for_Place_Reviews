$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path "$PSScriptRoot/../.."

Write-Host "Starting backend on :8090"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$repoRoot'; go run ./crawler/backend/cmd/server"

Write-Host "Starting frontend on :5173"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$repoRoot/crawler/frontend'; npm run dev"

Write-Host "Crawler dev services are starting in separate terminals."
