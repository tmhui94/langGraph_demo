from __future__ import annotations

import json
import re

import httpx

from app.core.config import settings
from app.schemas import JobRequirements
from app.services.search import search_web


def _string_items(items: object, fallback_label: str = "") -> list[str]:
    if not isinstance(items, list):
        return []

    values: list[str] = []
    for item in items:
        if isinstance(item, str):
            value = item.strip()
        elif isinstance(item, dict):
            value = (
                item.get("criterion")
                or item.get("skill")
                or item.get("qualification")
                or item.get("description")
                or item.get("name")
                or fallback_label
            )
            if isinstance(value, str) and item.get("description") and item.get("skill"):
                value = f"{item['skill']}: {item['description']}"
        else:
            value = str(item).strip()
        if value:
            values.append(value)

    return list(dict.fromkeys(values))


def _normalize_requirements(
    job_title: str,
    data: dict,
) -> JobRequirements:
    return JobRequirements(
        job_title=job_title,
        mandatory=_string_items(data.get("mandatory")),
        preferred=_string_items(data.get("preferred")),
        technical_skills=_string_items(data.get("technical_skills")),
        industries=_string_items(data.get("industries")),
        alternative_titles=_string_items(data.get("alternative_titles")),
        knockout_criteria=_string_items(data.get("knockout_criteria")),
        search_queries=_string_items(data.get("search_queries")),
    )


def _fallback_requirements(
    job_title: str,
    job_description: str,
    location: str,
    mandatory: list[str],
    preferred: list[str],
) -> JobRequirements:
    text = f"{job_title}\n{job_description}\n" + "\n".join(mandatory + preferred)
    skills = []
    for skill in ("C#", ".NET", "React", "Angular", "SQL Server", "REST", "Docker",
                  "Microservices", "Azure", "CI/CD", "IoT", "Python", "Java", "JavaScript"):
        if skill.lower() in text.lower():
            skills.append(skill)
    if not skills:
        skills = sorted(set(re.findall(r"\b[A-Za-z][A-Za-z0-9+#.-]{1,24}\b", text)))[:12]

    clean_mandatory = mandatory or [
        item.strip()
        for item in re.split(r"[.\n]", job_description)
        if any(word in item.lower() for word in ("minimum", "experience", "must", "required"))
    ]
    base = job_title
    titles = [base]
    if "software engineer" in base.lower():
        titles += ["Software Developer", "Full Stack Developer", ".NET Developer"]

    return JobRequirements(
        job_title=job_title,
        mandatory=clean_mandatory,
        preferred=preferred,
        technical_skills=skills,
        industries=["Enterprise software", "Technology"],
        alternative_titles=titles,
        knockout_criteria=clean_mandatory,
        search_queries=[
            f'"{title}" "{skill}" "{location}"' if location else f'"{title}" "{skill}"'
            for title in titles
            for skill in skills[:4]
        ],
    )


async def analyze_job_description(job_title: str, job_description: str, location: str,
                                  mandatory: list[str], preferred: list[str]) -> JobRequirements:
    if settings.anthropic_api_key:
        payload = {
            "model": settings.claude_api_model,
            "max_tokens": 4096,
            "system": (
                "Extract recruitment requirements and return only valid JSON. "
                "Every list must contain only strings, never objects. "
                "Use these exact keys: mandatory, preferred, technical_skills, "
                "industries, alternative_titles, knockout_criteria, search_queries."
            ),
            "messages": [
                {"role": "user", "content": json.dumps({
                    "job_title": job_title,
                    "job_description": job_description,
                    "location": location,
                    "mandatory": mandatory,
                    "preferred": preferred,
                })},
            ],
        }
        try:
            async with httpx.AsyncClient(timeout=45) as client:
                response = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": settings.anthropic_api_key,
                        "anthropic-version": "2023-06-01",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )
                response.raise_for_status()
                content_blocks = response.json()["content"]
                content = "".join(
                    block.get("text", "")
                    for block in content_blocks
                    if block.get("type") == "text"
                )
                content = content.strip()
                if content.startswith("```"):
                    content = re.sub(r"^```(?:json)?\s*", "", content)
                    content = re.sub(r"\s*```$", "", content)
                data = json.loads(content)
                return _normalize_requirements(job_title, data)
        except Exception as exc:
            print(f"Claude JD analysis failed; using deterministic fallback: {exc}")

    return _fallback_requirements(job_title, job_description, location, mandatory, preferred)


async def generate_claude_search_plan(
    requirements: JobRequirements,
    location: str,
) -> tuple[list[str], str]:
    if not settings.anthropic_api_key:
        return requirements.search_queries, "Claude API key not configured"

    tool = [{
        "name": "search_professional_profiles",
        "description": (
            "Search permitted web providers for public professional candidate profiles."
            " Use this tool before recommending the final search strategy."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Boolean or provider-neutral candidate search query",
                },
                "limit": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 10,
                    "default": 5,
                },
            },
            "required": ["query"],
        },
    }]

    request_messages = [{
        "role": "user",
        "content": json.dumps({
            "job_requirements": requirements.model_dump(),
            "location": location,
            "task": (
                "Use the search_professional_profiles tool to test one or more promising "
                "candidate searches. Then return only valid JSON with a single "
                "'search_queries' string-array key. Do not fabricate candidate information."
            ),
        }),
    }]

    try:
        async with httpx.AsyncClient(timeout=45) as client:
            for _ in range(3):
                response = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": settings.anthropic_api_key,
                        "anthropic-version": "2023-06-01",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": settings.claude_api_model,
                        "max_tokens": 4096,
                        "tools": tool,
                        "messages": request_messages,
                    },
                )
                response.raise_for_status()
                message = response.json()
                request_messages.append({
                    "role": "assistant",
                    "content": message["content"],
                })

                tool_calls = [
                    block for block in message["content"]
                    if block.get("type") == "tool_use"
                ]
                if not tool_calls:
                    text = "".join(
                        block.get("text", "")
                        for block in message["content"]
                        if block.get("type") == "text"
                    ).strip()
                    if text.startswith("```"):
                        text = re.sub(r"^```(?:json)?\s*", "", text)
                        text = re.sub(r"\s*```$", "", text)
                    data = json.loads(text)
                    queries = _string_items(data.get("search_queries"))
                    if queries:
                        return list(dict.fromkeys(queries)), "Claude selected search queries using tools"
                    break

                tool_results = []
                for tool_call in tool_calls:
                    tool_input = tool_call.get("input", {})
                    query = str(tool_input.get("query", "")).strip()
                    limit = int(tool_input.get("limit", 5))
                    results, limitation = await search_web(query, limit)
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": tool_call["id"],
                        "content": json.dumps({
                            "query": query,
                            "result_count": len(results),
                            "provider_limitation": limitation,
                            "source_summaries": [
                                {
                                    "title": item.get("title", ""),
                                    "url": item.get("url", ""),
                                    "excerpt": item.get("excerpt", "")[:300],
                                }
                                for item in results[:limit]
                            ],
                        }),
                    })
                request_messages.append({
                    "role": "user",
                    "content": tool_results,
                })
    except Exception as exc:
        print(f"Claude search tool loop failed; using generated queries: {exc}")

    return requirements.search_queries, "Claude search tool loop unavailable; using generated queries"
