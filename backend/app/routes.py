from __future__ import annotations

import json
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from .auth import (
    clear_session_cookie,
    create_session,
    delete_session,
    hash_password,
    require_current_user,
    set_session_cookie,
    verify_password,
)
from .db import get_conn
from .models import (
    FramingPreset,
    LoginIn,
    OpeningPreset,
    ProjectIn,
    ProjectOut,
    ProjectSummary,
    RegisterIn,
    SessionUser,
)
from .db import claim_legacy_data, seed_default_presets, table_has_column

router = APIRouter(prefix="/api")


@router.get("/auth/session", response_model=SessionUser)
def get_session(request: Request):
    return require_current_user(request)


@router.post("/auth/register", response_model=SessionUser, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterIn, request: Request, response: Response):
    email = payload.email.strip().lower()
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id FROM users WHERE lower(email)=lower(?)",
            (email,),
        ).fetchone()
        if existing:
            raise HTTPException(status.HTTP_409_CONFLICT, "Email already exists")
        salt_hex, password_hash = hash_password(payload.password)
        if table_has_column(conn, "users", "username"):
            cur = conn.execute(
                "INSERT INTO users (email, username, password_salt, password_hash) VALUES (?, ?, ?, ?)",
                (email, email, salt_hex, password_hash),
            )
        else:
            cur = conn.execute(
                "INSERT INTO users (email, password_salt, password_hash) VALUES (?, ?, ?)",
                (email, salt_hex, password_hash),
            )
        user_id = cur.lastrowid
        user_count = conn.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"]
        if user_count == 1:
            claim_legacy_data(conn, user_id)
        seed_default_presets(conn, user_id)
        token = create_session(conn, user_id)
        row = conn.execute(
            "SELECT id, email, created_at FROM users WHERE id=?",
            (user_id,),
        ).fetchone()
    set_session_cookie(response, request, token)
    return dict(row)


@router.post("/auth/login", response_model=SessionUser)
def login(payload: LoginIn, request: Request, response: Response):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, email, password_salt, password_hash, created_at FROM users WHERE lower(email)=lower(?)",
            (payload.email.strip().lower(),),
        ).fetchone()
        if not row or not verify_password(payload.password, row["password_salt"], row["password_hash"]):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
        token = create_session(conn, row["id"])
    set_session_cookie(response, request, token)
    return {
        "id": row["id"],
        "email": row["email"],
        "created_at": row["created_at"],
    }


@router.post("/auth/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get("designer_session")
    if token:
        with get_conn() as conn:
            delete_session(conn, token)
    clear_session_cookie(response)
    return {"ok": True}


# -------- Projects --------
@router.get("/projects", response_model=list[ProjectSummary])
def list_projects(user: dict = Depends(require_current_user)):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, name, units_mode, updated_at FROM projects WHERE user_id=? ORDER BY updated_at DESC",
            (user["id"],),
        ).fetchall()
    return [dict(r) for r in rows]


@router.post("/projects", response_model=ProjectOut)
def create_project(payload: ProjectIn, user: dict = Depends(require_current_user)):
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO projects (user_id, name, units_mode, data_json) VALUES (?, ?, ?, ?)",
            (user["id"], payload.name, payload.units_mode, json.dumps(payload.data)),
        )
        pid = cur.lastrowid
        row = conn.execute(
            "SELECT id, name, units_mode, data_json, created_at, updated_at FROM projects WHERE id=? AND user_id=?",
            (pid, user["id"]),
        ).fetchone()
    d = dict(row)
    d["data"] = json.loads(d.pop("data_json"))
    return d


@router.get("/projects/{pid}", response_model=ProjectOut)
def get_project(pid: int, user: dict = Depends(require_current_user)):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, name, units_mode, data_json, created_at, updated_at FROM projects WHERE id=? AND user_id=?",
            (pid, user["id"]),
        ).fetchone()
    if not row:
        raise HTTPException(404, "Project not found")
    d = dict(row)
    d["data"] = json.loads(d.pop("data_json"))
    return d


@router.put("/projects/{pid}", response_model=ProjectOut)
def update_project(pid: int, payload: ProjectIn, user: dict = Depends(require_current_user)):
    with get_conn() as conn:
        cur = conn.execute(
            """UPDATE projects
                  SET name=?, units_mode=?, data_json=?, updated_at=datetime('now')
                WHERE id=? AND user_id=?""",
            (payload.name, payload.units_mode, json.dumps(payload.data), pid, user["id"]),
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "Project not found")
        row = conn.execute(
            "SELECT id, name, units_mode, data_json, created_at, updated_at FROM projects WHERE id=? AND user_id=?",
            (pid, user["id"]),
        ).fetchone()
    d = dict(row)
    d["data"] = json.loads(d.pop("data_json"))
    return d


@router.delete("/projects/{pid}")
def delete_project(pid: int, user: dict = Depends(require_current_user)):
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM projects WHERE id=? AND user_id=?", (pid, user["id"]))
    if cur.rowcount == 0:
        raise HTTPException(404, "Project not found")
    return {"ok": True}


# -------- Presets --------
@router.get("/presets/framing", response_model=list[FramingPreset])
def list_framing_presets(user: dict = Depends(require_current_user)):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, name, stud_nominal, stud_width_in, stud_depth_in, spacing_oc_in, top_plates, bottom_plates FROM framing_presets WHERE user_id=? ORDER BY id",
            (user["id"],),
        ).fetchall()
    return [dict(r) for r in rows]


@router.post("/presets/framing", response_model=FramingPreset)
def add_framing_preset(p: FramingPreset, user: dict = Depends(require_current_user)):
    with get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO framing_presets
               (user_id, name, stud_nominal, stud_width_in, stud_depth_in,
                spacing_oc_in, top_plates, bottom_plates)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (user["id"], p.name, p.stud_nominal, p.stud_width_in, p.stud_depth_in,
             p.spacing_oc_in, p.top_plates, p.bottom_plates),
        )
        p.id = cur.lastrowid
    return p


@router.delete("/presets/framing/{pid}")
def delete_framing_preset(pid: int, user: dict = Depends(require_current_user)):
    with get_conn() as conn:
        conn.execute("DELETE FROM framing_presets WHERE id=? AND user_id=?", (pid, user["id"]))
    return {"ok": True}


@router.get("/presets/openings", response_model=list[OpeningPreset])
def list_opening_presets(user: dict = Depends(require_current_user)):
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, name, kind, rough_width_in, rough_height_in, head_height_in, sill_height_in, header_depth_in FROM opening_presets WHERE user_id=? ORDER BY kind, id",
            (user["id"],),
        ).fetchall()
    return [dict(r) for r in rows]


@router.post("/presets/openings", response_model=OpeningPreset)
def add_opening_preset(p: OpeningPreset, user: dict = Depends(require_current_user)):
    with get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO opening_presets
               (user_id, name, kind, rough_width_in, rough_height_in,
                head_height_in, sill_height_in, header_depth_in)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (user["id"], p.name, p.kind, p.rough_width_in, p.rough_height_in,
             p.head_height_in, p.sill_height_in, p.header_depth_in),
        )
        p.id = cur.lastrowid
    return p


@router.delete("/presets/openings/{pid}")
def delete_opening_preset(pid: int, user: dict = Depends(require_current_user)):
    with get_conn() as conn:
        conn.execute("DELETE FROM opening_presets WHERE id=? AND user_id=?", (pid, user["id"]))
    return {"ok": True}
