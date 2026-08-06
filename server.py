"""
FastAPI server for the Parcel Equalization Engine.

Endpoints
---------
POST /equalize
    Body: EqualizeRequest (JSON)
    Returns: GeoJSON FeatureCollection + stats

GET /health
    Returns: {"status": "ok"}

Static files
------------
The /ui route serves the browser-based interactive editor from gui/index.html.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from pee import equalize
from pee.exceptions import LoaderError, OptimizationError, ValidationError
from pee.loader import EdgeConfig

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Parcel Equalization Engine",
    description="Topology-preserving parcel area optimizer",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static GUI files
GUI_DIR = Path(__file__).parent / "gui"
if GUI_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(GUI_DIR)), name="static")


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class EdgeConfigRequest(BaseModel):
    v0: list[float] = Field(..., min_length=2, max_length=2, description="[x, y]")
    v1: list[float] = Field(..., min_length=2, max_length=2, description="[x, y]")
    movable: bool = True
    min_offset: float = -5.0
    max_offset: float = 5.0


class EqualizeRequest(BaseModel):
    geojson: dict = Field(
        ...,
        description=(
            'Input geometry. Either {"outer":…,"parcels":[…]} or a GeoJSON '
            'FeatureCollection with role="outer" / role="parcel" features.'
        ),
    )
    movable_edges: Optional[list[EdgeConfigRequest]] = Field(
        None,
        description="Explicit movable-edge configurations (by endpoint coords).",
    )
    all_interior_movable: bool = Field(
        False,
        description="Mark every interior edge movable with unconstrained bounds.",
    )
    target_areas: Optional[dict[str, float]] = Field(
        None,
        description="Absolute target area for each parcel, keyed by parcel ID string.",
    )
    weights: Optional[dict[str, float]] = Field(
        None,
        description="Relative target weights per parcel ID (alternative to target_areas).",
    )
    max_iter: int = Field(200, ge=1, le=10_000)
    tol: float = Field(1e-8, gt=0)
    validate_output: bool = Field(True, description="Run geometry validation.")


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/")
def ui():
    index = GUI_DIR / "index.html"
    if index.exists():
        return FileResponse(str(index))
    return {"message": "PEE API is running. POST to /equalize."}


@app.post("/equalize")
def equalize_endpoint(req: EqualizeRequest):
    # Convert string-keyed dicts to int-keyed
    target_areas = (
        {int(k): v for k, v in req.target_areas.items()}
        if req.target_areas
        else None
    )
    weights = (
        {int(k): v for k, v in req.weights.items()}
        if req.weights
        else None
    )

    movable_edges = None
    if req.movable_edges:
        movable_edges = [
            EdgeConfig(
                v0=tuple(e.v0),  # type: ignore[arg-type]
                v1=tuple(e.v1),  # type: ignore[arg-type]
                movable=e.movable,
                min_offset=e.min_offset,
                max_offset=e.max_offset,
            )
            for e in req.movable_edges
        ]

    try:
        result = equalize(
            req.geojson,
            movable_edges=movable_edges,
            all_interior_movable=req.all_interior_movable,
            target_areas=target_areas,
            weights=weights,
            max_iter=req.max_iter,
            tol=req.tol,
            validate_output=req.validate_output,
        )
    except LoaderError as exc:
        raise HTTPException(status_code=422, detail=f"Input error: {exc}") from exc
    except OptimizationError as exc:
        raise HTTPException(status_code=400, detail=f"Optimization error: {exc}") from exc
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=f"Geometry validation failed: {exc}") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Internal error: {exc}") from exc

    return result
