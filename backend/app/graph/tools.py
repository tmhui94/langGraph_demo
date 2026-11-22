"""Tools the sourcing agent can call. One registry feeds both the Claude API and the UI."""
from __future__ import annotations

import ipaddress
import json
import socket
from typing import Any, Awaitable, Callable
from urllib.parse import urlparse
from uuid import UUID

import httpx
from bs4 import BeautifulSoup

from app.core.config import settings
from app.schemas import Candidate, CandidateEvaluation, CriterionScore, SourceReference
from app.services.search import search_web
from app.services.store import store

CRITERIA = {
    "relevant_experience": "Relevant working experience",
    "technical_skills": "Technical skills",
    "industry_experience": "Industry experience",
    "education": "Educational qualifications",
    "projects_achievements": "Relevant projects and achievements",
    "certifications": "Professional certifications",
}

MAX_FETCH_CHARS = 4000

GITHUB_SYNTAX = (
    "The active provider is GitHub user search. Plain keyword phrases usually return nothing. Use "
    "qualifiers instead, e.g. 'location:malaysia language:csharp', 'location:selangor language:c#', "
    "'location:\"kuala lumpur\" language:javascript repos:>5', or 'dotnet in:bio location:malaysia'. "
    "Broaden by dropping the most specific qualifier (city -> state -> country)."
)


def search_hint() -> str:
    if settings.search_provider.lower() == "github":
        return GITHUB_SYNTAX
    return "Use natural web-search queries; quote exact phrases and include the location."


class ToolError(Exception):
    """Raised for failures the agent should see (returned with is_error=True)."""


def _strings() -> dict[str, Any]:
    return {"type": "array", "items": {"type": "string"}}


# ---- handlers -------------------------------------------------------------

async def search_professional_profiles(campaign_id: str, args: dict[str, Any]) -> dict[str, Any]:
    query = str(args.get("query", "")).strip()
    limit = max(1, min(int(args.get("limit", 5)), 10))
    if not query:
        raise ToolError("query is required")
    try:
        results, limitation = await search_web(query, limit)
    except httpx.HTTPError as exc:
        raise ToolError(f"search provider error: {exc}")
    return {
        "query": query,
        "provider_limitation": limitation,
        "hint": search_hint() if not results else "",
        "results": [
            {"title": r["title"], "url": r["url"], "excerpt": r.get("excerpt", "")[:300]}
            for r in results[:limit]
        ],
    }


def _assert_public_host(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ToolError("only http(s) URLs are allowed")
    try:
        infos = socket.getaddrinfo(parsed.hostname, None)
    except socket.gaierror:
        raise ToolError("host could not be resolved")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            raise ToolError("private or local addresses are not allowed")


async def fetch_public_profile(campaign_id: str, args: dict[str, Any]) -> dict[str, Any]:
    url = str(args.get("url", "")).strip()
    _assert_public_host(url)
    parsed = urlparse(url)
    host = parsed.netloc.lower()
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    if settings.github_token:
        headers["Authorization"] = f"Bearer {settings.github_token}"

    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        if host == "github.com":
            parts = [p for p in parsed.path.split("/") if p]
            if not parts:
                raise ToolError("GitHub URL has no user")
            login = parts[0]
            user = await client.get(f"https://api.github.com/users/{login}", headers=headers)
            if user.status_code in (401, 403, 404):
                raise ToolError(f"GitHub profile not accessible (HTTP {user.status_code})")
            user.raise_for_status()
            repos = await client.get(
                f"https://api.github.com/users/{login}/repos",
                headers=headers,
                params={"sort": "pushed", "per_page": 10},
            )
            repo_items = repos.json() if repos.status_code == 200 else []
            u = user.json()
            return {
                "source": "github_public_api",
                "url": u.get("html_url"),
                "name": u.get("name"),
                "bio": u.get("bio"),
                "company": u.get("company"),
                "location": u.get("location"),
                "public_repos": u.get("public_repos"),
                "top_repositories": [
                    {
                        "name": r.get("name"),
                        "language": r.get("language"),
                        "description": (r.get("description") or "")[:150],
                        "stars": r.get("stargazers_count"),
                    }
                    for r in repo_items
                    if isinstance(r, dict)
                ],
            }

        response = await client.get(url, headers={"User-Agent": "hr-sourcing-demo/1.0"})
        if response.status_code in (401, 403, 429, 999):
            raise ToolError(
                f"Page requires login or blocks automated access (HTTP {response.status_code}); "
                "not bypassing. Use the search excerpt as evidence instead."
            )
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")
        for tag in soup(["script", "style", "noscript"]):
            tag.decompose()
        text = " ".join(soup.get_text(" ").split())
        return {"source": "public_web_page", "url": url, "text": text[:MAX_FETCH_CHARS]}


async def record_candidate(campaign_id: str, args: dict[str, Any]) -> dict[str, Any]:
    campaign = store.get(UUID(campaign_id))
    profile_url = str(args["profile_url"]).strip()
    for existing in campaign.candidates:
        urls = {existing.linkedin_url, existing.github_url, existing.portfolio_url}
        if profile_url in urls:
            return {"candidate_id": str(existing.id), "duplicate": True}

    host = urlparse(profile_url).netloc.lower()
    sources = [SourceReference(url=profile_url, title=f"{args['name']} profile", kind="professional_profile")]
    for url in args.get("evidence_urls", []):
        if url != profile_url:
            sources.append(SourceReference(url=url, kind="evidence"))
    candidate = Candidate(
        name=args["name"],
        current_title=args.get("current_title") or "Not Found",
        current_company=args.get("current_company") or "Not Found",
        location=args.get("location") or "Not Found",
        linkedin_url=profile_url if "linkedin.com" in host else None,
        github_url=profile_url if "github.com" in host else None,
        portfolio_url=profile_url if "linkedin.com" not in host and "github.com" not in host else None,
        skills=list(args.get("skills", [])),
        summary=args.get("summary", ""),
        sources=sources,
    )
    campaign.candidates.append(candidate)
    store.save(campaign)
    return {"candidate_id": str(candidate.id), "duplicate": False, "recorded_total": len(campaign.candidates)}


def _band(total: float) -> str:
    return "HIGH" if total >= 80 else "MEDIUM" if total >= 60 else "LOW"


async def score_candidate(campaign_id: str, args: dict[str, Any]) -> dict[str, Any]:
    campaign = store.get(UUID(campaign_id))
    try:
        candidate_id = UUID(args["candidate_id"])
    except ValueError:
        raise ToolError("candidate_id is not a valid id; use the id returned by record_candidate")
    if not any(c.id == candidate_id for c in campaign.candidates):
        raise ToolError("unknown candidate_id; call record_candidate first")

    weights = campaign.scoring_weights.model_dump()
    given = {item["criterion"]: item for item in args.get("criteria", [])}
    scores: list[CriterionScore] = []
    for key, label in CRITERIA.items():
        item = given.get(key)
        score = max(0.0, min(100.0, float(item["score"]))) if item else 0.0
        scores.append(CriterionScore(
            name=label,
            score=score,
            weight=weights[key],
            weighted_score=round(score * weights[key] / 100, 2),
            evidence=list(item["evidence"]) if item else [],
            missing_information=list(item["missing_information"]) if item else ["Not assessed by the agent"],
        ))
    total = round(sum(s.weighted_score for s in scores), 2)
    unmet = list(args.get("unmet_mandatory", []))
    evaluation = CandidateEvaluation(
        candidate_id=candidate_id,
        criterion_scores=scores,
        total_score=total,
        category=_band(total),
        strengths=list(args.get("strengths", [])),
        weaknesses=list(args.get("weaknesses", [])),
        knockout_findings=[f"Mandatory requirement needs recruiter review: {m}" for m in unmet],
        recruiter_review_required=bool(unmet),
    )
    campaign.evaluations = [e for e in campaign.evaluations if e.candidate_id != candidate_id] + [evaluation]
    store.save(campaign)
    return {"total_score": total, "category": evaluation.category,
            "scored_so_far": len(campaign.evaluations)}


# ---- registry --------------------------------------------------------------

Handler = Callable[[str, dict[str, Any]], Awaitable[dict[str, Any]]]

TOOLS: list[dict[str, Any]] = [
    {
        "name": "search_professional_profiles",
        "description": (
            "Search the configured web provider for public professional profiles "
            "(GitHub, LinkedIn public pages, portfolios) matching a query. Returns title, URL and excerpt. "
            + search_hint()
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query, e.g. '\".NET developer\" Kajang GitHub'"},
                "limit": {"type": "integer", "description": "Max results, 1-10"},
            },
            "required": ["query", "limit"],
        },
        "handler": search_professional_profiles,
    },
    {
        "name": "fetch_public_profile",
        "description": (
            "Read a public profile page to gather evidence (bio, repositories, skills). "
            "GitHub profiles use the public API. Pages behind a login are refused."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"url": {"type": "string", "description": "Public profile URL"}},
            "required": ["url"],
        },
        "handler": fetch_public_profile,
    },
    {
        "name": "record_candidate",
        "description": (
            "Save a real candidate you found, with the source URL(s) that prove it. "
            "Never invent a candidate. Returns the candidate_id used for scoring."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "profile_url": {"type": "string"},
                "current_title": {"type": "string", "description": "Empty string if unknown"},
                "current_company": {"type": "string", "description": "Empty string if unknown"},
                "location": {"type": "string", "description": "Empty string if unknown"},
                "skills": {**_strings(), "description": "Only skills evidenced by the sources"},
                "summary": {"type": "string"},
                "evidence_urls": _strings(),
            },
            "required": ["name", "profile_url", "current_title", "current_company",
                         "location", "skills", "summary", "evidence_urls"],
        },
        "handler": record_candidate,
    },
    {
        "name": "score_candidate",
        "description": (
            "Record your evidence-based assessment of a recorded candidate. Score each criterion "
            "0-100 from the evidence only; missing evidence is not negative evidence, so list it under "
            "missing_information. The server applies the campaign weights and computes the total."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "candidate_id": {"type": "string"},
                "criteria": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "criterion": {"type": "string", "enum": list(CRITERIA.keys())},
                            "score": {"type": "number", "description": "0-100"},
                            "evidence": _strings(),
                            "missing_information": _strings(),
                        },
                        "required": ["criterion", "score", "evidence", "missing_information"],
                    },
                },
                "strengths": _strings(),
                "weaknesses": _strings(),
                "unmet_mandatory": {**_strings(), "description": "Mandatory requirements not evidenced"},
            },
            "required": ["candidate_id", "criteria", "strengths", "weaknesses", "unmet_mandatory"],
        },
        "handler": score_candidate,
    },
]

HANDLERS: dict[str, Handler] = {t["name"]: t["handler"] for t in TOOLS}


def api_tools() -> list[dict[str, Any]]:
    """Tool definitions in the Anthropic API shape (no handler)."""
    from app.services.llm import strictify

    return [
        {
            "name": t["name"],
            "description": t["description"],
            "input_schema": strictify(t["input_schema"]),
            "strict": True,
        }
        for t in TOOLS
    ]


def catalog() -> list[dict[str, str]]:
    """What the UI shows in the 'tools available' step."""
    return [{"name": t["name"], "description": t["description"]} for t in TOOLS]


async def run_tool(campaign_id: str, name: str, tool_input: dict[str, Any]) -> tuple[str, bool]:
    """Execute a tool; returns (content, is_error)."""
    handler = HANDLERS.get(name)
    if handler is None:
        return f"Unknown tool: {name}", True
    try:
        return json.dumps(await handler(campaign_id, tool_input)), False
    except ToolError as exc:
        return str(exc), True
    except Exception as exc:  # unexpected failure is still shown to the agent, not fatal
        return f"{type(exc).__name__}: {exc}", True
