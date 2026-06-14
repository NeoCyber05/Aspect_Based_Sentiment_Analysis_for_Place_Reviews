# Place Review Sentiment Analyzer

Aspect-Based Sentiment Analysis for place reviews — crawl, analyze, visualize.

**Stack:**

![Go](https://img.shields.io/badge/Go-%2300ADD8.svg?style=for-the-badge&logo=go&logoColor=white) ![FastAPI](https://img.shields.io/badge/FastAPI-%23009688.svg?style=for-the-badge&logo=FastAPI&logoColor=white) ![React](https://img.shields.io/badge/react-%2320232a.svg?style=for-the-badge&logo=react&logoColor=%2361dafb) ![Vite](https://img.shields.io/badge/vite-%23646CFF.svg?style=for-the-badge&logo=vite&logoColor=white) ![SQLite](https://img.shields.io/badge/sqlite-%2307405e.svg?style=for-the-badge&logo=sqlite&logoColor=white) ![PyTorch](https://img.shields.io/badge/PyTorch-%23EE4C2C.svg?style=for-the-badge&logo=PyTorch&logoColor=white)

## Quick Start

Hot-reload development without building Docker images. Requirements: Python virtual environment, Go, Node.js.

```powershell
# First time setup: create venv & install Python dependencies
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt

# Run all 3 services (absa at :8091, backend at :8090, frontend at :5173) in separate windows
.\dev.ps1 up
# or: .\run.ps1 dev

# Stop all services
.\dev.ps1 stop
```

`dev.ps1` automatically runs `npm install` for the frontend if `node_modules` is missing. Modifying Python files (`.py`) triggers uvicorn reload; editing React files triggers Vite HMR; Go backend recompiles upon restarting the service window.

## Manual Dev Start

Three terminals:

```bash
# Terminal 1 - ABSA service
python -m review_absa_pipeline.service

# Terminal 2 - Go backend
cd crawler/backend && go run ./cmd/server -absa-service-url http://127.0.0.1:8091

# Terminal 3 - React frontend
cd crawler/frontend && npm install && npm run dev
```

Configure `crawler/frontend/.env.local` with `VITE_VIETMAP_API_KEY` for map features.

## Load Models

```bash
pip install -r requirements.txt
python load_hf_model.py --repo-id NeoCyber/m-e5-small-vlsp2018-hotel --text "Phòng sạch sẽ, nhân viên thân thiện"
```

## Run Docker

```bash
docker compose up -d
```

Open http://localhost:5173

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| Go API | http://localhost:8090/api/health |
| Python ABSA | http://localhost:8091/health |
