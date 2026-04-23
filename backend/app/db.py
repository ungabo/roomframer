"""SQLite helpers. Auto-creates DB file and schema on first import."""
from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)
DB_PATH = DATA_DIR / "designer.db"
SCHEMA_PATH = Path(__file__).with_name("schema.sql")


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def init_db() -> None:
    schema = SCHEMA_PATH.read_text(encoding="utf-8")
    with _connect() as conn:
        conn.executescript(schema)
        # seed default presets if empty
        cur = conn.execute("SELECT COUNT(*) AS c FROM framing_presets")
        if cur.fetchone()["c"] == 0:
            conn.executemany(
                """INSERT INTO framing_presets
                   (name, stud_nominal, stud_width_in, stud_depth_in,
                    spacing_oc_in, top_plates, bottom_plates)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                [
                    ("2x4 @ 16\" OC", "2x4", 1.5, 3.5, 16, 2, 1),
                    ("2x4 @ 24\" OC", "2x4", 1.5, 3.5, 24, 2, 1),
                    ("2x6 @ 16\" OC", "2x6", 1.5, 5.5, 16, 2, 1),
                    ("2x6 @ 24\" OC", "2x6", 1.5, 5.5, 24, 2, 1),
                ],
            )
        cur = conn.execute("SELECT COUNT(*) AS c FROM opening_presets")
        if cur.fetchone()["c"] == 0:
            conn.executemany(
                """INSERT INTO opening_presets
                   (name, kind, rough_width_in, rough_height_in,
                    head_height_in, sill_height_in, header_depth_in)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                # head_height = top of rough opening (= bottom of header).
                # For windows: head_height = sill_height + rough_height.
                [
                    # Doors (sill_height = 0)
                    ("Door 2'-8\" x 6'-8\"", "door", 32.0, 80.0, 80.0, 0.0, 3.5),
                    ("Door 3'-0\" x 6'-8\"", "door", 36.0, 80.0, 80.0, 0.0, 3.5),
                    ("Door 3'-0\" x 7'-0\"", "door", 36.0, 84.0, 84.0, 0.0, 3.5),
                    ("Double Door 5'-0\" x 6'-8\"", "door", 60.0, 80.0, 80.0, 0.0, 5.5),
                    # Windows
                    ("Window 2'-0\" x 3'-0\"", "window", 24.0, 36.0, 72.0, 36.0, 3.5),
                    ("Window 3'-0\" x 4'-0\"", "window", 36.0, 48.0, 72.0, 24.0, 3.5),
                    ("Window 4'-0\" x 4'-0\"", "window", 48.0, 48.0, 72.0, 24.0, 5.5),
                    ("Window 6'-0\" x 4'-0\" (slider)", "window", 72.0, 48.0, 72.0, 24.0, 7.25),
                ],
            )
        conn.commit()


@contextmanager
def get_conn():
    conn = _connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


# Initialize on import so the app always has a ready DB.
init_db()
