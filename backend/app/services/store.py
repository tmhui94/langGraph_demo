from __future__ import annotations

from collections import defaultdict
from threading import RLock
from uuid import UUID
from datetime import datetime

from sqlalchemy.orm import Session

from app.schemas import Campaign
from app.db import CampaignSnapshot, sync_engine


class CampaignStore:
    def __init__(self) -> None:
        self._campaigns: dict[UUID, Campaign] = {}
        self._lock = RLock()

    def save(self, campaign: Campaign) -> Campaign:
        with self._lock:
            self._campaigns[campaign.id] = campaign
        try:
            with Session(sync_engine) as session:
                snapshot = session.get(CampaignSnapshot, str(campaign.id))
                if snapshot is None:
                    snapshot = CampaignSnapshot(id=str(campaign.id))
                snapshot.job_title = campaign.job_title
                snapshot.status = campaign.status
                snapshot.snapshot = campaign.model_dump(mode="json")
                snapshot.updated_at = datetime.utcnow()
                session.add(snapshot)
                session.commit()
        except Exception:
            pass
        return campaign

    def get(self, campaign_id: UUID) -> Campaign:
        with self._lock:
            return self._campaigns[campaign_id]

    def list(self) -> list[Campaign]:
        with self._lock:
            return list(self._campaigns.values())


store = CampaignStore()
