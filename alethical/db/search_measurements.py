"""Private search records are not members of the public application metadata."""

from datetime import datetime

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class SearchMeasurementBase(DeclarativeBase):
    pass


class SearchMeasurementSnapshot(SearchMeasurementBase):
    __tablename__ = "snapshot"
    __table_args__ = {"schema": "search_measurement_private"}

    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    provider: Mapped[str] = mapped_column(String(16))
    view: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16))
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    raw_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    payload: Mapped[dict | None] = mapped_column(
        JSONB(none_as_null=True), nullable=True
    )
    summary: Mapped[dict] = mapped_column(JSONB)


class SearchMeasurementMaintenance(SearchMeasurementBase):
    __tablename__ = "maintenance"
    __table_args__ = {"schema": "search_measurement_private"}

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    last_success_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    raw_cleared: Mapped[int] = mapped_column(Integer)
    summaries_removed: Mapped[int] = mapped_column(Integer)
