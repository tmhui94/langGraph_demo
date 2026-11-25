from __future__ import annotations

import asyncio
import json
from typing import Any
from uuid import UUID

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.core.config import settings
from app.graph.workflow import workflow
from app.schemas import Campaign, CampaignCreate
from app.services.events import bus
from app.services.llm import LLMNotConfigured
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
    if payload.saved_requirements is not None and payload.saved_plan:
        campaign.requirements = payload.saved_requirements
        campaign.plan = payload.saved_plan
        campaign.adapted = payload.adapt
        campaign.reused = not payload.adapt
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


async def run_campaign(campaign: Campaign) -> None:
    """Run the graph in the background; progress is published to the event bus."""
    cid = str(campaign.id)
    initial: dict[str, Any] = {
        "campaign_id": cid,
        "job_title": campaign.job_title,
        "job_description": campaign.job_description,
        "location": campaign.location,
        "minimum_candidates": campaign.minimum_candidates,
        "mandatory": campaign.mandatory_qualifications,
        "preferred": campaign.preferred_qualifications,
        "iterations": 0,
        "limitation": "",
        "reused": campaign.reused,
        "adapted": campaign.adapted,
    }
    try:
        await workflow.ainvoke(initial, {"recursion_limit": 100})
    except LLMNotConfigured as exc:
        campaign.status = "FAILED"
        campaign.limitation = str(exc)
        bus.publish(cid, {"type": "error", "node": "start", "detail": str(exc)})
    except Exception as exc:
        campaign.status = "FAILED"
        campaign.limitation = f"{type(exc).__name__}: {exc}"
        bus.publish(cid, {"type": "error", "node": "start", "detail": campaign.limitation})
    finally:
        bus.publish(cid, {"type": "done", "status": campaign.status})
        campaign.events = bus.history(cid)
        store.save(campaign)


_background: set[asyncio.Task] = set()


@app.post("/api/campaigns/{campaign_id}/start", response_model=Campaign)
async def start_campaign(campaign_id: UUID) -> Campaign:
    try:
        campaign = store.get(campaign_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if campaign.status in ("RUNNING", "ANALYZING", "PLANNING", "SOURCING", "REPORTING"):
        raise HTTPException(status_code=409, detail="Campaign is already running")

    bus.reset(campaign_id)
    campaign.status = "RUNNING"
    campaign.candidates, campaign.evaluations = [], []
    campaign.events, campaign.summary, campaign.limitation = [], "", ""
    if not (campaign.reused or campaign.adapted):  # a saved agent keeps its requirements and plan
        campaign.plan = []
    store.save(campaign)
    task = asyncio.create_task(run_campaign(campaign))
    _background.add(task)  # keep a reference so the task is not garbage collected
    task.add_done_callback(_background.discard)
    return campaign


@app.get("/api/campaigns/{campaign_id}/events")
async def campaign_events(campaign_id: UUID):
    try:
        campaign = store.get(campaign_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Campaign not found")

    async def stream():
        queue = bus.subscribe(campaign_id)
        try:
            # Subscribe first, then replay, so nothing is missed in between.
            seen = 0
            finished = False
            for item in bus.history(campaign_id):
                seen = max(seen, item["seq"])
                finished = finished or item["type"] == "done"
                yield "data: " + json.dumps(item) + chr(10) + chr(10)
            if finished or campaign.status in ("COMPLETED", "FAILED", "DRAFT"):
                return
            while True:
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=15)
                except asyncio.TimeoutError:
                    yield ": keep-alive" + chr(10) + chr(10)
                    continue
                if item["seq"] <= seen:
                    continue
                yield "data: " + json.dumps(item) + chr(10) + chr(10)
                if item["type"] == "done":
                    return
        finally:
            bus.unsubscribe(campaign_id, queue)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


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
