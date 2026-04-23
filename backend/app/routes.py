from __future__ import annotations

import json
from fastapi import APIRouter, HTTPException

from .db import get_conn
from .models import (
    FramingPreset,
    OpeningPreset,
    ProjectIn,
    ProjectOut,
    ProjectSummary,
)

router = APIRouter(prefix="/api")


# -------- Projects --------
@router.get("/projects", response_model=list[ProjectSummary])
def list_projects():
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, name, units_mode, updated_at FROM projects ORDER BY updated_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]


@router.post("/projects", response_model=ProjectOut)
def create_project(payload: ProjectIn):
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO projects (name, units_mode, data_json) VALUES (?, ?, ?)",
            (payload.name, payload.units_mode, json.dumps(payload.data)),
        )
        pid = cur.lastrowid
        row = conn.execute(
            "SELECT id, name, units_mode, data_json, created_at, updated_at FROM projects WHERE id=?",
            (pid,),
        ).fetchone()
    d = dict(row)
    d["data"] = json.loads(d.pop("data_json"))
    return d


@router.get("/projects/{pid}", response_model=ProjectOut)
def get_project(pid: int):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, name, units_mode, data_json, created_at, updated_at FROM projects WHERE id=?",
            (pid,),
        ).fetchone()
    if not row:
        raise HTTPException(404, "Project not found")
    d = dict(row)
    d["data"] = json.loads(d.pop("data_json"))
    return d


@router.put("/projects/{pid}", response_model=ProjectOut)
def update_project(pid: int, payload: ProjectIn):
    with get_conn() as conn:
        cur = conn.execute(
            """UPDATE projects
                  SET name=?, units_mode=?, data_json=?, updated_at=datetime('now')
                WHERE id=?""",
            (payload.name, payload.units_mode, json.dumps(payload.data), pid),
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "Project not found")
        row = conn.execute(
            "SELECT id, name, units_mode, data_json, created_at, updated_at FROM projects WHERE id=?",
            (pid,),
        ).fetchone()
    d = dict(row)
    d["data"] = json.loads(d.pop("data_json"))
    return d


@router.delete("/projects/{pid}")
def delete_project(pid: int):
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM projects WHERE id=?", (pid,))
    if cur.rowcount == 0:
        raise HTTPException(404, "Project not found")
    return {"ok": True}


# -------- Presets --------
@router.get("/presets/framing", response_model=list[FramingPreset])
def list_framing_presets():
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM framing_presets ORDER BY id").fetchall()
    return [dict(r) for r in rows]


@router.post("/presets/framing", response_model=FramingPreset)
def add_framing_preset(p: FramingPreset):
    with get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO framing_presets
               (name, stud_nominal, stud_width_in, stud_depth_in,
                spacing_oc_in, top_plates, bottom_plates)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (p.name, p.stud_nominal, p.stud_width_in, p.stud_depth_in,
             p.spacing_oc_in, p.top_plates, p.bottom_plates),
        )
        p.id = cur.lastrowid
    return p


@router.delete("/presets/framing/{pid}")
def delete_framing_preset(pid: int):
    with get_conn() as conn:
        conn.execute("DELETE FROM framing_presets WHERE id=?", (pid,))
    return {"ok": True}


@router.get("/presets/openings", response_model=list[OpeningPreset])
def list_opening_presets():
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM opening_presets ORDER BY kind, id").fetchall()
    return [dict(r) for r in rows]


@router.post("/presets/openings", response_model=OpeningPreset)
def add_opening_preset(p: OpeningPreset):
    with get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO opening_presets
               (name, kind, rough_width_in, rough_height_in,
                head_height_in, sill_height_in, header_depth_in)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (p.name, p.kind, p.rough_width_in, p.rough_height_in,
             p.head_height_in, p.sill_height_in, p.header_depth_in),
        )
        p.id = cur.lastrowid
    return p


@router.delete("/presets/openings/{pid}")
def delete_opening_preset(pid: int):
    with get_conn() as conn:
        conn.execute("DELETE FROM opening_presets WHERE id=?", (pid,))
    return {"ok": True}
