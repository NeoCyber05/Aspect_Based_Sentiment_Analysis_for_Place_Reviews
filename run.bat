@echo off
echo ========================================
echo   ABSA Review Intelligence - Docker
echo ========================================
echo.

REM Check Docker
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [LOI] Docker chua duoc cai dat hoac chua chay.
    echo Hay cai Docker Desktop tu: https://www.docker.com/products/docker-desktop
    exit /b 1
)

REM Parse command
if "%1"=="" (
    echo Su dung: run.bat [lenh]
    echo.
    echo Cac lenh:
    echo   up      - Khoi dong toan bo project
    echo   down    - Dung project
    echo   build   - Build lai tat ca images
    echo   logs    - Xem logs tat ca services
    echo   status  - Kiem tra trang thai
    exit /b 0
)

if "%1"=="up" (
    echo [1/3] Build images (neu chua co)...
    docker compose build
    echo [2/3] Khoi dong services...
    docker compose up -d
    echo [3/3] Done!
    echo.
    echo Truy cap frontend: http://localhost:5173
    echo Truy cap backend:  http://localhost:8090/api/health
    echo Truy cap ABSA:     http://localhost:8091/health
    echo.
    echo Dang theo doi logs (Ctrl+C de thoat, services van chay)...
    docker compose logs -f
)

if "%1"=="down" (
    docker compose down
    echo Da dung toan bo services.
)

if "%1"=="build" (
    docker compose build --no-cache
    echo Build hoan tat.
)

if "%1"=="logs" (
    docker compose logs -f
)

if "%1"=="status" (
    docker compose ps
)
