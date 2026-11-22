from sqlalchemy import Column, DateTime, JSON, String
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import create_engine

from app.core.config import settings


class Base(DeclarativeBase):
    pass


class CampaignSnapshot(Base):
    __tablename__ = "campaign_snapshots"

    id = Column(String(36), primary_key=True)
    job_title = Column(String(255), nullable=False)
    status = Column(String(50), nullable=False)
    snapshot = Column(JSON, nullable=False)
    updated_at = Column(DateTime, nullable=False)


engine = create_async_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
sync_url = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
sync_engine = create_engine(sync_url, pool_pre_ping=True)


async def initialize_database() -> None:
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
