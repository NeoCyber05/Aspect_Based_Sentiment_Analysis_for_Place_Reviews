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
    echo.
    echo   dev      - Chay nhanh KHONG Docker (native, hot-reload)
    echo   dev-stop - Dung cac service native (port 8091/8090/5173)
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

REM ===== Native dev (KHONG Docker) =====
if "%1"=="dev" (
    if not exist ".venv\Scripts\python.exe" (
        echo [LOI] Khong thay .venv. Tao venv + cai requirements truoc.
        exit /b 1
    )
    echo [1/3] ABSA  : http://localhost:8091
    start "ABSA :8091" cmd /k ".venv\Scripts\python.exe -m uvicorn review_absa_pipeline.service:create_app --factory --host 0.0.0.0 --port 8091 --reload"
    echo [2/3] Backend: http://localhost:8090
    start "Backend :8090" cmd /k "cd crawler\backend && go run ./cmd/server --addr=:8090 --absa-service-url=http://127.0.0.1:8091 --disable-auto-analysis --concurrency=1 --poll-interval=2s"
    echo [3/3] Frontend: http://localhost:5173
    start "Frontend :5173" cmd /k "cd crawler\frontend && npm run dev -- --host"
    echo.
    echo Done. Ollama can chay rieng tai http://localhost:11434
    echo Dung tat ca: run.bat dev-stop  (hoac dong tung cua so)
)

if "%1"=="dev-stop" (
    for %%P in (8091 8090 5173) do (
        for /f "tokens=5" %%I in ('netstat -ano ^| findstr ":%%P " ^| findstr LISTENING') do (
            echo Killing PID %%I on port %%P
            taskkill /F /PID %%I >nul 2>&1
        )
    )
    echo Done.
)
