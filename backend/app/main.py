from __future__ import annotations

from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from .auth import optional_current_user
from .routes import router

BASE_DIR = Path(__file__).resolve().parents[2]  # .../designer
FRONTEND_DIR = BASE_DIR / "frontend"

app = FastAPI(title="Wall Framing Designer", version="0.1.0")
app.include_router(router)


@app.get("/")
def index(request: Request):
    if optional_current_user(request) is None:
        return RedirectResponse("/login", status_code=303)
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/login")
def login_page(request: Request):
    if optional_current_user(request) is not None:
        return RedirectResponse("/", status_code=303)
    return FileResponse(FRONTEND_DIR / "login.html")


@app.get("/register")
def register_page(request: Request):
    if optional_current_user(request) is not None:
        return RedirectResponse("/", status_code=303)
    return FileResponse(FRONTEND_DIR / "register.html")


# Static frontend assets
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")
