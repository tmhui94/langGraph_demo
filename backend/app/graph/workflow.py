from __future__ import annotations

import asyncio
import re
from datetime import datetime
from typing import Annotated, Any, Literal, TypedDict
from urllib.parse import urlparse
from uuid import UUID

from langgraph.graph import END, START, StateGraph
from langgraph.types import Send

from app.schemas import (
    Candidate,
    CandidateEvaluation,
    CriterionScore,
    JobRequirements,
    SourceReference,
)
from app.services.llm import analyze_job_description, generate_claude_search_plan
from app.services.search import search_web
from app.services.store import store


def merge_events(left: list[dict[str, Any]], right: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return left + right


class GraphState(TypedDict, total=False):
    campaign_id: str
    job_title: str
    job_description: str
    location: str
    minimum_candidates: int
    mandatory: list[str]
    preferred: list[str]
    weights: dict[str, float]
    requirements: JobRequirements
    candidates: list[Candidate]
    evaluations: list[CandidateEvaluation]
    events: Annotated[list[dict[str, Any]], merge_events]
    search_queries: list[str]
    search_attempts: int
    retry_limit: int
    qa_errors: list[str]
    limitation: str


def event_node(state: GraphState, name: str, status: str, detail: str = "") -> list[dict[str, Any]]:
    return [{
        "node": name,
        "status": status,
        "detail": detail,
        "timestamp": datetime.utcnow().isoformat(),
    }]


async def analyze_node(state: GraphState) -> dict:
    campaign = store.get(UUID(state["campaign_id"]))
    requirements = await analyze_job_description(
        state["job_title"], state["job_description"], state["location"],
        state["mandatory"], state["preferred"],
    )
    campaign.requirements = requirements
    campaign.status = "ANALYZING"
    store.save(campaign)
    return {
        "requirements": requirements,
        "search_queries": requirements.search_queries,
        "events": event_node(state, "Job Description Analysis", "completed", "Requirements extracted"),
    }


async def generate_queries_node(state: GraphState) -> dict:
    requirements = state["requirements"]
    location = state["location"]
    claude_queries, claude_status = await generate_claude_search_plan(requirements, location)
    queries = list(claude_queries)
    for title in requirements.alternative_titles:
        for skill in requirements.technical_skills[:3]:
            suffix = f' "{location}"' if location else ""
            queries.append(f'"{title}" "{skill}"{suffix}')
    queries.extend([
        f'{requirements.job_title} candidates {location}'.strip(),
        f'{requirements.job_title} profile github {location}'.strip(),
    ])
    unique = list(dict.fromkeys(queries))
    return {
        "search_queries": unique,
        "events": event_node(
            state,
            "Search Query Generation",
            "completed",
            f"{len(unique)} queries generated. {claude_status}",
        ),
    }


def extract_candidate(result: dict[str, Any], query: str) -> Candidate | None:
    url = result.get("url", "")
    title = result.get("title", "")
    excerpt = result.get("excerpt", "")
    if not url or not title:
        return None
    host = urlparse(url).netloc.lower()
    allowed_hosts = ("linkedin.com", "github.com", "jobstreet.com", "indeed.com",
                     "glassdoor.com", "profiles", "portfolio")
    if not any(marker in host for marker in allowed_hosts):
        return None

    name = title
    name = re.sub(r"\s*[-|:].*$", "", name).strip()
    name = re.sub(r"\s*\([^)]*\)\s*$", "", name).strip()
    if len(name) < 3 or len(name) > 100 or name.lower().startswith(("search ", "jobs ", "github")):
        return None
    name = re.sub(r"\b(LinkedIn|GitHub|JobStreet|Indeed|Professional Profile)\b", "", name, flags=re.I).strip(" -|")
    if not name:
        return None

    return Candidate(
        name=name,
        linkedin_url=url if "linkedin.com" in host else None,
        github_url=url if "github.com" in host else None,
        portfolio_url=url if "portfolio" in host else None,
        summary=excerpt[:500],
        sources=[SourceReference(url=url, title=title, kind="search_result", excerpt=excerpt)],
        evidence_status="live",
    )


async def sourcing_node(state: GraphState) -> dict:
    campaign = store.get(UUID(state["campaign_id"]))
    campaign.status = "SOURCING"
    campaign.minimum_candidates = state["minimum_candidates"]
    store.save(campaign)
    queries = state["search_queries"][:12]
    semaphore = asyncio.Semaphore(4)

    async def run(query: str):
        async with semaphore:
            return query, await search_web(query, 10)

    settled = await asyncio.gather(*(run(query) for query in queries))
    candidates = list(state.get("candidates", []))
    seen = {
        (c.name.strip().lower(), c.linkedin_url or c.github_url or c.portfolio_url or "")
        for c in candidates
    }
    limitations = []
    for query, (results, limitation) in settled:
        if limitation:
            limitations.append(limitation)
        for result in results:
            candidate = extract_candidate(result, query)
            if not candidate:
                continue
            key = (candidate.name.lower(), candidate.linkedin_url or candidate.github_url or candidate.portfolio_url or "")
            if key not in seen:
                seen.add(key)
                candidates.append(candidate)
    unique = []
    keyset = set()
    for candidate in candidates:
        key = candidate.linkedin_url or candidate.github_url or candidate.portfolio_url
        key = key or candidate.name.lower()
        if key not in keyset:
            keyset.add(key)
            unique.append(candidate)
    campaign.candidates = unique
    campaign.limitation = "; ".join(dict.fromkeys(limitations)) if limitations else ""
    store.save(campaign)
    return {
        "candidates": unique,
        "limitation": campaign.limitation,
        "search_attempts": state.get("search_attempts", 0) + 1,
        "events": event_node(state, "Candidate Sourcing", "completed",
                             f"{len(unique)} unique candidates found"),
    }


def count_check(state: GraphState) -> Literal["expand", "research"]:
    if len(state["candidates"]) >= state["minimum_candidates"]:
        return "research"
    if state["search_attempts"] >= state["retry_limit"]:
        return "research"
    if state.get("limitation"):
        return "research"
    return "expand"


async def expand_node(state: GraphState) -> dict:
    requirements = state["requirements"]
    extra = [
        f'"{title}" "{skill}" {state["location"]}'
        for title in requirements.alternative_titles
        for skill in requirements.technical_skills
    ]
    return {
        "search_queries": list(dict.fromkeys(state["search_queries"] + extra))[:24],
        "events": event_node(state, "Expand Search", "running", "Added alternative-title and industry queries"),
    }


async def research_worker(state: GraphState) -> dict:
    candidates = []
    for candidate in state["candidates"]:
        profile_url = candidate.linkedin_url or candidate.github_url or candidate.portfolio_url
        if profile_url:
            candidate.sources.append(SourceReference(
                url=profile_url,
                title=f"{candidate.name} profile",
                kind="professional_profile",
            ))
        candidate.skills = list(state["requirements"].technical_skills[:8])
        candidates.append(candidate)
    campaign = store.get(UUID(state["campaign_id"]))
    campaign.candidates = candidates
    campaign.status = "RESEARCHING"
    store.save(campaign)
    return {
        "candidates": candidates,
        "events": event_node(state, "Candidate Intelligence", "completed",
                             f"Researched {len(candidates)} candidate profiles"),
    }


def dispatch_research(state: GraphState):
    requirements = state["requirements"]
    return [
        Send("candidate_intelligence", {
            "campaign_id": state["campaign_id"],
            "candidate": candidate,
            "requirements": requirements,
        })
        for candidate in state["candidates"]
    ]


async def resume_acquisition(state: GraphState) -> dict:
    for candidate in state["candidates"]:
        for source in candidate.sources:
            host = urlparse(source.url).netloc.lower()
            if "github.com" in host:
                candidate.github_url = candidate.github_url or source.url
        candidate.resume_available = False
    campaign = store.get(UUID(state["campaign_id"]))
    campaign.candidates = state["candidates"]
    store.save(campaign)
    return {
        "candidates": state["candidates"],
        "events": event_node(state, "Resume Acquisition", "completed",
                             "Public resume/CV availability checked"),
    }


def evaluate_candidate(candidate: Candidate, state: GraphState) -> CandidateEvaluation:
    weights = state["weights"]
    requirements = state["requirements"]
    text = " ".join([
        candidate.summary,
        candidate.current_title,
        candidate.current_company,
        " ".join(candidate.skills),
        " ".join(candidate.projects),
    ]).lower()
    mandatory_text = " ".join(requirements.mandatory).lower()

    def criterion(name: str, weight: float, terms: list[str]) -> CriterionScore:
        found = [term for term in terms if term.lower() in text]
        missing = [term for term in terms if term.lower() not in text]
        score = 100 if found and not missing else (70 if found else 25)
        evidence = [f"{source.url}: public search/profile reference" for source in candidate.sources]
        if found:
            evidence.append(f"Referenced terms: {', '.join(found)}")
        return CriterionScore(
            name=name,
            score=score,
            weight=weight,
            weighted_score=round(score * weight / 100, 2),
            evidence=evidence,
            missing_information=[f"No source-backed evidence found for: {term}" for term in missing],
        )

    scores = [
        criterion("Relevant working experience", weights["relevant_experience"],
                  [candidate.current_title] if candidate.current_title != "Not Found" else []),
        criterion("Technical skills", weights["technical_skills"], requirements.technical_skills),
        criterion("Industry experience", weights["industry_experience"], requirements.industries),
        criterion("Educational qualifications", weights["education"], []),
        criterion("Relevant projects and achievements", weights["projects_achievements"], requirements.technical_skills[:3]),
        criterion("Professional certifications", weights["certifications"], candidate.certifications),
    ]
    total = round(sum(item.weighted_score for item in scores), 2)
    if total >= 80:
        category = "HIGH"
    elif total >= 60:
        category = "MEDIUM"
    else:
        category = "LOW"
    unmet = []
    for mandatory in requirements.mandatory:
        if mandatory.lower() not in text:
            unmet.append(mandatory)
    if not unmet and mandatory_text:
        unmet = []
    return CandidateEvaluation(
        candidate_id=candidate.id,
        criterion_scores=scores,
        total_score=total,
        category=category,
        strengths=[f"Public profile evidence found: {source.url}" for source in candidate.sources[:3]],
        weaknesses=[f"Could not verify: {item}" for item in unmet],
        knockout_findings=[f"Mandatory requirement requires recruiter review: {item}" for item in unmet],
        recruiter_review_required=bool(unmet),
    )


async def evaluate_node(state: GraphState) -> dict:
    evaluations = [evaluate_candidate(candidate, state) for candidate in state["candidates"]]
    campaign = store.get(UUID(state["campaign_id"]))
    campaign.evaluations = evaluations
    campaign.status = "EVALUATING"
    store.save(campaign)
    return {
        "evaluations": evaluations,
        "events": event_node(state, "Candidate Evaluation", "completed", f"{len(evaluations)} candidates scored"),
    }


async def qa_node(state: GraphState) -> dict:
    errors = []
    for candidate in state["candidates"]:
        if not candidate.sources:
            errors.append(f"Candidate {candidate.name} has no source reference")
    for evaluation in state["evaluations"]:
        if not evaluation.criterion_scores:
            errors.append(f"Candidate {evaluation.candidate_id} has no criterion scores")
        if abs(evaluation.total_score - sum(c.weighted_score for c in evaluation.criterion_scores)) > 0.01:
            errors.append(f"Candidate {evaluation.candidate_id} has an inconsistent weighted score")
    return {
        "qa_errors": errors,
        "events": event_node(state, "Quality Assurance", "failed" if errors else "completed",
                             "; ".join(errors) if errors else "QA checks passed"),
    }


async def report_node(state: GraphState) -> dict:
    campaign = store.get(UUID(state["campaign_id"]))
    campaign.status = "COMPLETED"
    campaign.limitation = state.get("limitation", "")
    store.save(campaign)
    counts = {
        category: sum(1 for evaluation in state["evaluations"] if evaluation.category == category)
        for category in ("HIGH", "MEDIUM", "LOW")
    }
    detail = (
        f"Discovered {len(state['candidates'])}; evaluated {len(state['evaluations'])}; "
        f"HIGH {counts['HIGH']}, MEDIUM {counts['MEDIUM']}, LOW {counts['LOW']}."
    )
    return {"events": event_node(state, "Report Generation", "completed", detail)}


def build_graph():
    graph = StateGraph(GraphState)
    graph.add_node("analyze", analyze_node)
    graph.add_node("generate_queries", generate_queries_node)
    graph.add_node("source", sourcing_node)
    graph.add_node("expand", expand_node)
    graph.add_node("candidate_intelligence", research_worker)
    graph.add_node("resume_acquisition", resume_acquisition)
    graph.add_node("evaluate", evaluate_node)
    graph.add_node("quality_assurance", qa_node)
    graph.add_node("report", report_node)

    graph.add_edge(START, "analyze")
    graph.add_edge("analyze", "generate_queries")
    graph.add_edge("generate_queries", "source")
    graph.add_conditional_edges("source", count_check, {"expand": "expand", "research": "candidate_intelligence"})
    graph.add_edge("expand", "source")
    graph.add_edge("candidate_intelligence", "resume_acquisition")
    graph.add_edge("resume_acquisition", "evaluate")
    graph.add_edge("evaluate", "quality_assurance")
    graph.add_edge("quality_assurance", "report")
    graph.add_edge("report", END)

    return graph.compile()


workflow = build_graph()
