from __future__ import annotations

import hashlib
import hmac
import secrets
import sqlite3

from fastapi import HTTPException, Request, Response, status

from .db import get_conn

SESSION_COOKIE = "designer_session"
SESSION_MAX_AGE = 60 * 60 * 24 * 400


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def hash_password(password: str, salt_hex: str | None = None) -> tuple[str, str]:
    salt_hex = salt_hex or secrets.token_hex(16)
    digest = hashlib.scrypt(
        password.encode("utf-8"),
        salt=bytes.fromhex(salt_hex),
        n=2**14,
        r=8,
        p=1,
    ).hex()
    return salt_hex, digest


def verify_password(password: str, salt_hex: str, expected_hash: str) -> bool:
    _, actual_hash = hash_password(password, salt_hex)
    return hmac.compare_digest(actual_hash, expected_hash)


def create_session(conn: sqlite3.Connection, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    conn.execute(
        """INSERT INTO sessions (user_id, token_hash, expires_at)
           VALUES (?, ?, datetime('now', '+400 days'))""",
        (user_id, _sha256(token)),
    )
    return token


def delete_session(conn: sqlite3.Connection, token: str) -> None:
    conn.execute("DELETE FROM sessions WHERE token_hash=?", (_sha256(token),))


def _load_session_user(conn: sqlite3.Connection, token: str, refresh: bool) -> sqlite3.Row | None:
    row = conn.execute(
                """SELECT u.id, u.email, u.created_at, s.id AS session_id
             FROM sessions s
             JOIN users u ON u.id = s.user_id
            WHERE s.token_hash=?
              AND s.expires_at > datetime('now')""",
        (_sha256(token),),
    ).fetchone()
    if row and refresh:
        conn.execute(
            "UPDATE sessions SET expires_at=datetime('now', '+400 days') WHERE id=?",
            (row["session_id"],),
        )
    return row


def optional_current_user(request: Request) -> dict | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    with get_conn() as conn:
        row = _load_session_user(conn, token, refresh=True)
    if not row:
        return None
    return {
        "id": row["id"],
        "email": row["email"],
        "created_at": row["created_at"],
    }


def require_current_user(request: Request) -> dict:
    user = optional_current_user(request)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authentication required")
    return user


def set_session_cookie(response: Response, request: Request, token: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=SESSION_MAX_AGE,
        expires=SESSION_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=request.url.scheme == "https",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=SESSION_COOKIE, path="/")