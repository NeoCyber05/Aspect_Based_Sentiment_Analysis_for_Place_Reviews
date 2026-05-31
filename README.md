# ABSA Review Intelligence

Aspect-Based Sentiment Analysis for place reviews — crawl, analyze, visualize.

**Stack:** Go + FastAPI + React + Vite + SQLite + PyTorch

## Quick Start (Docker)

```bash
docker compose up -d
```

Open http://localhost:5173

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| Go API | http://localhost:8090/api/health |
| Python ABSA | http://localhost:8091/health |

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

## Run Tests

```bash
# Python
python -m unittest tests.test_review_absa_analysis -v

# Go
cd crawler/backend && go test ./internal/app -v

# Frontend build
cd crawler/frontend && npm run build
```

## Optional: Ollama Narrative

Set `ABSA_OLLAMA_URL` / `ABSA_OLLAMA_MODEL` env vars to enable AI-generated Vietnamese narratives alongside ABSA metrics.
