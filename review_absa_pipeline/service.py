from __future__ import annotations

from pathlib import Path
from typing import Any

from .engine import AnalysisEngine
from .model_manager import DEFAULT_DOMAIN_MODEL_REPOS, ModelManager


def create_app(engine: AnalysisEngine | None = None):
    try:
        from fastapi import FastAPI, HTTPException
        from pydantic import BaseModel, Field
    except ImportError as exc:
        raise RuntimeError(
            "FastAPI service dependencies are missing. Install fastapi and uvicorn."
        ) from exc

    class AnalyzeCSVRequest(BaseModel):
        job_id: str = Field(min_length=1)
        csv_path: str = Field(min_length=1)
        force: bool = False
        model_repos: dict[str, str] = Field(default_factory=lambda: dict(DEFAULT_DOMAIN_MODEL_REPOS))

    app = FastAPI(title="ABSA Review Analysis Service")
    analysis_engine = engine

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/v1/analyze-csv")
    def analyze_csv(request: AnalyzeCSVRequest) -> dict[str, Any]:
        nonlocal analysis_engine
        csv_path = Path(request.csv_path)
        if not csv_path.exists():
            raise HTTPException(status_code=404, detail=f"CSV not found: {csv_path}")
        if analysis_engine is None:
            analysis_engine = AnalysisEngine(model_manager=ModelManager(model_repos=request.model_repos))
        try:
            return analysis_engine.analyze_csv(
                job_id=request.job_id,
                csv_path=csv_path,
                force=request.force,
            )
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    return app


def main() -> None:
    try:
        import uvicorn
    except ImportError as exc:
        raise SystemExit("Install uvicorn to run the ABSA service.") from exc
    uvicorn.run(
        "review_absa_pipeline.service:create_app",
        factory=True,
        host="127.0.0.1",
        port=8091,
    )


if __name__ == "__main__":
    main()
