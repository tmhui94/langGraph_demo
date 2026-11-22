from __future__ import annotations

import asyncio
from typing import Any
from uuid import UUID

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.core.config import settings
from app.graph.workflow import workflow
from app.schemas import Campaign, CampaignCreate
from app.services.store import store
from app.db import initialize_database

app = FastAPI(
    title="AI-Powered HR Sourcing Agent",
    version="1.0.0",
    description="LangGraph-driven professional candidate sourcing and recruiter review.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_origins.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup() -> None:
    try:
        await initialize_database()
    except Exception:
        pass


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/campaigns", response_model=Campaign)
async def create_campaign(payload: CampaignCreate) -> Campaign:
    campaign = Campaign(
        job_title=payload.job_title,
        job_description=payload.job_description,
        location=payload.location,
        mandatory_qualifications=payload.mandatory_qualifications,
        preferred_qualifications=payload.preferred_qualifications,
        minimum_candidates=payload.minimum_candidates,
        scoring_weights=payload.scoring_weights,
    )
    return store.save(campaign)


@app.get("/api/campaigns", response_model=list[Campaign])
async def list_campaigns() -> list[Campaign]:
    return store.list()


@app.get("/api/campaigns/{campaign_id}", response_model=Campaign)
async def get_campaign(campaign_id: UUID) -> Campaign:
    try:
        return store.get(campaign_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Campaign not found")


@app.post("/api/campaigns/{campaign_id}/start", response_model=Campaign)
async def start_campaign(campaign_id: UUID) -> Campaign:
    try:
        campaign = store.get(campaign_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Campaign not found")

    weights = campaign.scoring_weights.model_dump()
    campaign.status = "RUNNING"
    campaign.events = [{
        "node": "START",
        "status": "completed",
        "detail": "Campaign started",
    }]
    store.save(campaign)
    initial: dict[str, Any] = {
        "campaign_id": str(campaign.id),
        "job_title": campaign.job_title,
        "job_description": campaign.job_description,
        "location": campaign.location,
        "minimum_candidates": campaign.minimum_candidates,
        "mandatory": campaign.mandatory_qualifications,
        "preferred": campaign.preferred_qualifications,
        "weights": weights,
        "candidates": [],
        "evaluations": [],
        "events": [],
        "search_attempts": 0,
        "retry_limit": 3,
        "qa_errors": [],
        "limitation": "",
    }
    final = await workflow.ainvoke(initial)
    campaign = store.get(campaign_id)
    campaign.events = initial["events"] + final.get("events", [])
    store.save(campaign)
    return campaign


@app.get("/api/campaigns/{campaign_id}/events")
async def campaign_events(campaign_id: UUID):
    try:
        campaign = store.get(campaign_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Campaign not found")

    async def stream():
        for item in campaign.events:
            yield f"data: {item}\n\n"
            await asyncio.sleep(0.05)

    return StreamingResponse(stream(), media_type="text/event-stream")


@app.get("/api/campaigns/{campaign_id}/candidates")
async def campaign_candidates(campaign_id: UUID):
    try:
        campaign = store.get(campaign_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return {"candidates": campaign.candidates, "evaluations": campaign.evaluations}


@app.get("/api/campaigns/{campaign_id}/report")
async def campaign_report(campaign_id: UUID):
    try:
        campaign = store.get(campaign_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Campaign not found")
    distribution = {
        category: sum(1 for evaluation in campaign.evaluations if evaluation.category == category)
        for category in ("HIGH", "MEDIUM", "LOW")
    }
    ranked = sorted(
        zip(campaign.candidates, campaign.evaluations),
        key=lambda pair: pair[1].total_score,
        reverse=True,
    )
    top = [
        {"candidate": candidate.model_dump(mode="json"), "evaluation": evaluation.model_dump(mode="json")}
        for candidate, evaluation in ranked[:10]
    ]
    return {
        "campaign": campaign.model_dump(mode="json"),
        "summary": {
            "job_description": campaign.job_description,
            "total_discovered": len(campaign.candidates),
            "total_evaluated": len(campaign.evaluations),
            "distribution": distribution,
            "limitation": campaign.limitation,
        },
        "top_10": top,
    }
