from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .engine import AnalysisEngine
from .model_manager import DEFAULT_DOMAIN_MODEL_REPOS, ModelManager
from .narrative import generate_narrative


class AnalyzeCSVRequest(BaseModel):
    job_id: str = Field(min_length=1)
    csv_path: str = Field(min_length=1)
    force: bool = False
    model_repos: dict[str, str] = Field(default_factory=lambda: dict(DEFAULT_DOMAIN_MODEL_REPOS))


class NarrativeRequest(BaseModel):
    analysis_result: dict[str, Any]
    use_ollama: bool = True


def create_app(engine: AnalysisEngine | None = None):
    app = FastAPI(title="ABSA Review Analysis Service")
    analysis_engine = engine
    if analysis_engine is None:
        analysis_engine = AnalysisEngine(model_manager=ModelManager())
        analysis_engine.model_manager.preload()

    @app.get("/health")
    def health() -> dict[str, str]:
        loaded = analysis_engine.model_manager.loaded_domains
        return {"status": "ok", "models_loaded": ", ".join(loaded) if loaded else "none"}

    @app.post("/v1/analyze-csv")
    def analyze_csv(req: AnalyzeCSVRequest) -> dict[str, Any]:
        nonlocal analysis_engine
        csv_path = Path(req.csv_path)
        if not csv_path.exists():
            raise HTTPException(status_code=404, detail=f"CSV not found: {csv_path}")
        if analysis_engine is None:
            analysis_engine = AnalysisEngine(model_manager=ModelManager(model_repos=req.model_repos))
        try:
            return analysis_engine.analyze_csv(
                job_id=req.job_id,
                csv_path=csv_path,
                force=req.force,
            )
        except Exception as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/v1/narrative")
    def narrative(req: NarrativeRequest) -> dict[str, Any]:
        return generate_narrative(req.analysis_result, use_ollama=req.use_ollama)

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