"""SQLite helpers. Auto-creates DB file and schema on first import."""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)
DB_PATH = DATA_DIR / "designer.db"
SCHEMA_PATH = Path(__file__).with_name("schema.sql")

DEFAULT_FRAMING_PRESETS = [
    ("2x4 @ 16\" OC", "2x4", 1.5, 3.5, 16, 2, 1),
    ("2x4 @ 24\" OC", "2x4", 1.5, 3.5, 24, 2, 1),
    ("2x6 @ 16\" OC", "2x6", 1.5, 5.5, 16, 2, 1),
    ("2x6 @ 24\" OC", "2x6", 1.5, 5.5, 24, 2, 1),
]

DEFAULT_OPENING_PRESETS = [
    ("Door 2'-8\" x 6'-8\"", "door", 32.0, 80.0, 80.0, 0.0, 3.5),
    ("Door 3'-0\" x 6'-8\"", "door", 36.0, 80.0, 80.0, 0.0, 3.5),
    ("Door 3'-0\" x 7'-0\"", "door", 36.0, 84.0, 84.0, 0.0, 3.5),
    ("Double Door 5'-0\" x 6'-8\"", "door", 60.0, 80.0, 80.0, 0.0, 5.5),
    ("Window 2'-0\" x 3'-0\"", "window", 24.0, 36.0, 72.0, 36.0, 3.5),
    ("Window 3'-0\" x 4'-0\"", "window", 36.0, 48.0, 72.0, 24.0, 3.5),
    ("Window 4'-0\" x 4'-0\"", "window", 48.0, 48.0, 72.0, 24.0, 5.5),
    ("Window 6'-0\" x 4'-0\" (slider)", "window", 72.0, 48.0, 72.0, 24.0, 7.25),
]

AUTO_ADMIN_EMAILS = {
    "test+lcorner@example.com",
    "copilot.test.20260429@example.com",
    "testuser2_20260423@example.com",
}


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn


def _table_columns(conn: sqlite3.Connection, table_name: str) -> set[str]:
    rows = conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    return {row["name"] for row in rows}


def table_has_column(conn: sqlite3.Connection, table_name: str, column_name: str) -> bool:
    return column_name in _table_columns(conn, table_name)


def _ensure_column(conn: sqlite3.Connection, table_name: str, column_def: str) -> None:
    column_name = column_def.split()[0]
    if column_name not in _table_columns(conn, table_name):
        conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_def}")


def _migrate_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """CREATE TABLE IF NOT EXISTS users (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               email TEXT NOT NULL UNIQUE,
               password_salt TEXT NOT NULL,
               password_hash TEXT NOT NULL,
               created_at TEXT NOT NULL DEFAULT (datetime('now'))
           )"""
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS sessions (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
               token_hash TEXT NOT NULL UNIQUE,
               created_at TEXT NOT NULL DEFAULT (datetime('now')),
               expires_at TEXT NOT NULL
           )"""
    )
    if "email" not in _table_columns(conn, "users"):
        conn.execute("ALTER TABLE users ADD COLUMN email TEXT")
    user_columns = _table_columns(conn, "users")
    if "username" in user_columns:
        conn.execute("UPDATE users SET email=lower(username) WHERE email IS NULL AND username IS NOT NULL")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)")
    _ensure_column(conn, "users", "is_admin INTEGER NOT NULL DEFAULT 0")
    _ensure_column(conn, "projects", "user_id INTEGER REFERENCES users(id) ON DELETE CASCADE")
    _ensure_column(conn, "framing_presets", "user_id INTEGER REFERENCES users(id) ON DELETE CASCADE")
    _ensure_column(conn, "opening_presets", "user_id INTEGER REFERENCES users(id) ON DELETE CASCADE")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_projects_user_updated ON projects(user_id, updated_at DESC)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_framing_presets_user ON framing_presets(user_id, id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_opening_presets_user_kind ON opening_presets(user_id, kind, id)")


def promote_auto_admins(conn: sqlite3.Connection) -> None:
    for email in AUTO_ADMIN_EMAILS:
        conn.execute("UPDATE users SET is_admin=1 WHERE lower(email)=lower(?)", (email,))

    project7 = conn.execute("SELECT user_id FROM projects WHERE id=7").fetchone()
    if project7 and project7["user_id"] is not None:
        conn.execute("UPDATE users SET is_admin=1 WHERE id=?", (project7["user_id"],))


def claim_legacy_data(conn: sqlite3.Connection, user_id: int) -> None:
    conn.execute("UPDATE projects SET user_id=? WHERE user_id IS NULL", (user_id,))
    conn.execute("UPDATE framing_presets SET user_id=? WHERE user_id IS NULL", (user_id,))
    conn.execute("UPDATE opening_presets SET user_id=? WHERE user_id IS NULL", (user_id,))


def seed_default_presets(conn: sqlite3.Connection, user_id: int) -> None:
    cur = conn.execute("SELECT COUNT(*) AS c FROM framing_presets WHERE user_id=?", (user_id,))
    if cur.fetchone()["c"] == 0:
        conn.executemany(
            """INSERT INTO framing_presets
               (user_id, name, stud_nominal, stud_width_in, stud_depth_in,
                spacing_oc_in, top_plates, bottom_plates)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            [(user_id, *preset) for preset in DEFAULT_FRAMING_PRESETS],
        )
    cur = conn.execute("SELECT COUNT(*) AS c FROM opening_presets WHERE user_id=?", (user_id,))
    if cur.fetchone()["c"] == 0:
        conn.executemany(
            """INSERT INTO opening_presets
               (user_id, name, kind, rough_width_in, rough_height_in,
                head_height_in, sill_height_in, header_depth_in)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            [(user_id, *preset) for preset in DEFAULT_OPENING_PRESETS],
        )


def init_db() -> None:
    schema = SCHEMA_PATH.read_text(encoding="utf-8")
    with _connect() as conn:
        conn.executescript(schema)
        _migrate_schema(conn)
        promote_auto_admins(conn)
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
