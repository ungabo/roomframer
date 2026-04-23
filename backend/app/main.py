from __future__ import annotations

from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from .routes import router

BASE_DIR = Path(__file__).resolve().parents[2]  # .../designer
FRONTEND_DIR = BASE_DIR / "frontend"

app = FastAPI(title="Wall Framing Designer", version="0.1.0")
app.include_router(router)


@app.get("/")
def index():
    return FileResponse(FRONTEND_DIR / "index.html")


# Static frontend assets
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")
