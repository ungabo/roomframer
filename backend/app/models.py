from __future__ import annotations

from typing import Any, Optional
from pydantic import BaseModel, Field


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    units_mode: str = Field(default="ftin", pattern=r"^(ftin|inches)$")
    data: dict[str, Any]


class ProjectOut(BaseModel):
    id: int
    name: str
    units_mode: str
    data: dict[str, Any]
    created_at: str
    updated_at: str


class ProjectSummary(BaseModel):
    id: int
    name: str
    units_mode: str
    updated_at: str


class SessionUser(BaseModel):
    id: int
    email: str
    created_at: str


class RegisterIn(BaseModel):
    email: str = Field(min_length=5, max_length=120, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=8, max_length=200)


class LoginIn(BaseModel):
    email: str = Field(min_length=5, max_length=120, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=8, max_length=200)


class FramingPreset(BaseModel):
    id: Optional[int] = None
    name: str
    stud_nominal: str
    stud_width_in: float
    stud_depth_in: float
    spacing_oc_in: float
    top_plates: int = 2
    bottom_plates: int = 1


class OpeningPreset(BaseModel):
    id: Optional[int] = None
    name: str
    kind: str = Field(pattern=r"^(door|window)$")
    rough_width_in: float
    rough_height_in: float
    head_height_in: float
    sill_height_in: float = 0.0
    header_depth_in: float = 3.5
