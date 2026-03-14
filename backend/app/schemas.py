from __future__ import annotations

from datetime import date, datetime, time
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, PositiveInt, field_validator


def _validate_password(v: str) -> str:
    if len(v) < 8:
        raise ValueError("Пароль должен содержать минимум 8 символов")
    if not any(c.isdigit() for c in v):
        raise ValueError("Пароль должен содержать хотя бы одну цифру")
    if not any(c.isalpha() for c in v):
        raise ValueError("Пароль должен содержать хотя бы одну букву")
    return v


def _strip(value: Optional[str]) -> Optional[str]:
    if value is None:
        return value
    return value.strip()


class OfficeBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    address: Optional[str] = Field(None, max_length=300)

    def model_post_init(self, __context: object) -> None:
        self.name = _strip(self.name) or ""
        if self.address is not None:
            self.address = _strip(self.address)


class OfficeCreate(OfficeBase):
    pass


class Office(OfficeBase):
    model_config = ConfigDict(from_attributes=True)
    id: PositiveInt


class OfficeUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    address: Optional[str] = Field(None, max_length=300)

    def model_post_init(self, __context: object) -> None:
        if self.name is not None:
            self.name = _strip(self.name) or ""
        if self.address is not None:
            self.address = _strip(self.address)


class FloorBase(BaseModel):
    office_id: PositiveInt
    name: str = Field(..., min_length=1, max_length=120)
    plan_url: Optional[str] = Field(None, max_length=500)

    def model_post_init(self, __context: object) -> None:
        self.name = _strip(self.name) or ""
        if self.plan_url is not None:
            self.plan_url = _strip(self.plan_url) or None


class FloorCreate(FloorBase):
    pass


class Floor(FloorBase):
    model_config = ConfigDict(from_attributes=True)
    id: PositiveInt


class FloorUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    plan_url: Optional[str] = Field(None, max_length=500)

    def model_post_init(self, __context: object) -> None:
        if self.name is not None:
            self.name = _strip(self.name) or ""
        if self.plan_url is not None:
            self.plan_url = _strip(self.plan_url) or None


class DeskBase(BaseModel):
    floor_id: PositiveInt
    label: str = Field(..., min_length=1, max_length=40)
    type: str = Field("flex", pattern="^(flex|fixed)$")
    space_type: str = Field("desk", pattern="^(desk|meeting_room|call_room|open_space|lounge)$")
    assigned_to: Optional[str] = Field(None, max_length=120)
    position_x: Optional[float] = Field(None, ge=0, le=1)
    position_y: Optional[float] = Field(None, ge=0, le=1)
    w: float = Field(0.07, ge=0.01, le=1)
    h: float = Field(0.05, ge=0.01, le=1)

    def model_post_init(self, __context: object) -> None:
        self.label = _strip(self.label) or ""
        if self.assigned_to is not None:
            self.assigned_to = _strip(self.assigned_to) or None


class DeskCreate(DeskBase):
    pass


class DeskFromMap(BaseModel):
    label: str = Field(..., min_length=1, max_length=40)
    type: str = Field("flex", pattern="^(flex|fixed)$")
    space_type: str = Field("desk", pattern="^(desk|meeting_room|call_room|open_space|lounge)$")
    assigned_to: Optional[str] = Field(None, max_length=120)
    position_x: float = Field(..., ge=0, le=1)
    position_y: float = Field(..., ge=0, le=1)
    w: float = Field(0.07, ge=0.01, le=1)
    h: float = Field(0.05, ge=0.01, le=1)

    def model_post_init(self, __context: object) -> None:
        self.label = (self.label or "").strip()
        if self.assigned_to is not None:
            self.assigned_to = self.assigned_to.strip() or None


class Desk(DeskBase):
    model_config = ConfigDict(from_attributes=True)
    id: PositiveInt
    qr_token: str


class DeskUpdate(BaseModel):
    label: Optional[str] = Field(None, min_length=1, max_length=40)
    type: Optional[str] = Field(None, pattern="^(flex|fixed)$")
    space_type: Optional[str] = Field(None, pattern="^(desk|meeting_room|call_room|open_space|lounge)$")
    assigned_to: Optional[str] = Field(None, max_length=120)
    position_x: Optional[float] = Field(None, ge=0, le=1)
    position_y: Optional[float] = Field(None, ge=0, le=1)

    def model_post_init(self, __context: object) -> None:
        if self.label is not None:
            self.label = _strip(self.label) or ""
        if self.assigned_to is not None:
            self.assigned_to = _strip(self.assigned_to) or None


class ReservationBase(BaseModel):
    desk_id: PositiveInt
    user_id: str = Field(..., min_length=1, max_length=120)
    reservation_date: date
    start_time: time
    end_time: time

    def model_post_init(self, __context: object) -> None:
        self.user_id = _strip(self.user_id) or ""


class ReservationCreate(ReservationBase):
    pass


class Reservation(ReservationBase):
    model_config = ConfigDict(from_attributes=True)
    id: PositiveInt
    status: str = Field("active", pattern="^(active|cancelled)$")
    checked_in_at: Optional[datetime] = None


class AvailabilityResponse(BaseModel):
    available: bool
    reason: Optional[str] = None


class AvailabilityBatchRequest(BaseModel):
    desk_ids: list[int] = Field(..., min_length=1, max_length=500)
    reservation_date: date
    start_time: time
    end_time: time
    user_id: Optional[str] = None


class AvailabilityBatchItem(BaseModel):
    desk_id: int
    available: bool
    reason: Optional[str] = None


class AvailabilityBatchResponse(BaseModel):
    results: list[AvailabilityBatchItem]


# ---------------------------------------------------------------------------
# Batch reservations
# ---------------------------------------------------------------------------

class ReservationBatchCreate(BaseModel):
    desk_id: PositiveInt
    dates: list[date] = Field(..., min_length=1, max_length=60)
    start_time: time = Field(..., description="Start time in HH:MM format")
    end_time: time = Field(..., description="End time in HH:MM format")


class ReservationBatchResult(BaseModel):
    created: list[Reservation]
    skipped: list[date]
    errors: list[str]


class PolicyBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    office_id: Optional[PositiveInt] = None
    min_days_ahead: int = Field(0, ge=0, le=365)
    max_days_ahead: int = Field(30, ge=0, le=365)
    min_duration_minutes: int = Field(30, ge=15, le=1440)
    max_duration_minutes: int = Field(480, ge=15, le=1440)
    no_show_timeout_minutes: int = Field(15, ge=0, le=120)

    def model_post_init(self, __context: object) -> None:
        self.name = _strip(self.name) or ""


class PolicyCreate(PolicyBase):
    pass


class Policy(PolicyBase):
    model_config = ConfigDict(from_attributes=True)
    id: PositiveInt


class PolicyUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    office_id: Optional[PositiveInt] = None
    min_days_ahead: Optional[int] = Field(None, ge=0, le=365)
    max_days_ahead: Optional[int] = Field(None, ge=0, le=365)
    min_duration_minutes: Optional[int] = Field(None, ge=15, le=1440)
    max_duration_minutes: Optional[int] = Field(None, ge=15, le=1440)
    no_show_timeout_minutes: Optional[int] = Field(None, ge=0, le=120)

    def model_post_init(self, __context: object) -> None:
        if self.name is not None:
            self.name = _strip(self.name) or ""


class DeskStat(BaseModel):
    desk_id: int
    label: str
    floor_name: str
    office_name: str
    total: int


class UserStat(BaseModel):
    user_id: str
    total: int


class AnalyticsResponse(BaseModel):
    total_today: int
    total_active: int
    total_cancelled: int
    noshow_rate: float
    occupancy_by_office: list[dict]
    top_desks: list[DeskStat]
    top_users: list[UserStat]


class Message(BaseModel):
    message: str


class PasswordChange(BaseModel):
    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=8)

    @field_validator("new_password")
    @classmethod
    def password_complexity(cls, v: str) -> str:
        return _validate_password(v)


# ---------------------------------------------------------------------------
# Auth schemas
# ---------------------------------------------------------------------------

class UserRegister(BaseModel):
    username: str = Field(..., min_length=2, max_length=120)
    email: str = Field(..., max_length=320)
    password: str = Field(..., min_length=8)
    role: str = Field("user", pattern="^(admin|user)$")
    admin_secret: Optional[str] = None

    @field_validator("password")
    @classmethod
    def password_complexity(cls, v: str) -> str:
        return _validate_password(v)


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: PositiveInt
    username: str
    email: str
    role: str
    full_name: Optional[str] = None
    department: Optional[str] = None
    position: Optional[str] = None
    phone: Optional[str] = None
    user_status: str = "available"
    is_active: bool = True


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    full_name: Optional[str] = None
    department: Optional[str] = None
    position: Optional[str] = None
    phone: Optional[str] = None
    user_status: str = "available"
    is_active: bool = True


class UserLocation(BaseModel):
    desk_id: int
    desk_label: Optional[str] = None
    floor_id: int
    floor_name: Optional[str] = None
    office_id: int
    office_name: Optional[str] = None


class UserWithLocation(UserPublic):
    location: Optional[UserLocation] = None


class UserProfileUpdate(BaseModel):
    full_name: Optional[str] = Field(None, max_length=255)
    department: Optional[str] = Field(None, max_length=120)
    position: Optional[str] = Field(None, max_length=120)
    phone: Optional[str] = Field(None, max_length=30)
    user_status: Optional[str] = Field(None, pattern="^(available|busy|away)$")


# ---------------------------------------------------------------------------
# Departments
# ---------------------------------------------------------------------------

class DepartmentCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)


class Department(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str


# ---------------------------------------------------------------------------
# Favorites
# ---------------------------------------------------------------------------

class FavoriteCreate(BaseModel):
    desk_id: PositiveInt


class FavoriteItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    desk_id: int


class UserAdminUpdate(BaseModel):
    role: Optional[str] = Field(None, pattern="^(admin|user)$")
    is_active: Optional[bool] = None
