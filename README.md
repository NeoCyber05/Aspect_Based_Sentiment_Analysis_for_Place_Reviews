# Aspect-Based Sentiment Analysis for Place Reviews

<p>
  <img src="https://img.shields.io/badge/Go-00ADD8?style=for-the-badge&logo=go&logoColor=white" alt="Go" />
  <img src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React" />
  <img src="https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white" alt="SQLite" />
  <img src="https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js" />
</p>

This project provides a full workflow for collecting place reviews and preparing data that can be used for aspect-based sentiment analysis.  
It includes a Go backend that manages crawl jobs and CSV exports, and a React frontend that lets you create, monitor, and download jobs from a web UI.

## What This Project Does

- Creates crawl jobs for place-related keywords.
- Processes jobs in the background with a worker loop.
- Stores job metadata in SQLite.
- Exports crawl results to CSV per job.
- Provides a browser UI for managing jobs and selecting locations on a map.



## Quick Start

### 1) Clone and enter the project

```bash
git clone <your-repo-url>
cd Aspect_Based_Sentiment_Analysis_for_Place_Reviews
```

### 2) Configure frontend environment

Create `crawler/frontend/.env.local`:

```env
VITE_VIETMAP_API_KEY=your_vietmap_api_key
# Optional (default is http://localhost:8090)
VITE_API_BASE_URL=http://localhost:8090
```

### 3) Run development services

From the `crawler` directory:

- **Windows (PowerShell)**
  ```powershell
  ./scripts/dev.ps1
  ```

- **Linux/macOS (Bash)**
  ```bash
  ./scripts/dev.sh
  ```

This starts:
- Backend at `http://localhost:8090`
- Frontend at `http://localhost:5173`



### Backend

```bash
cd crawler/backend
go run ./cmd/server
```

### Frontend

```bash
cd crawler/frontend
npm install
npm run dev
```

