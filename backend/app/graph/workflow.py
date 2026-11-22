"""LangGraph agent: understand -> discover tools -> plan -> (agent <-> tools)* -> report."""
from __future__ import annotations

import asyncio
import json
from functools import wraps
from typing import Any, Literal, TypedDict
from uuid import UUID

from langgraph.graph import END, START, StateGraph

from app.core.config import settings
from app.graph.tools import api_tools, catalog, run_tool
from app.schemas import JobRequirements
from app.services.events import bus
from app.services.llm import json_of, stream_claude, text_of
from app.services.store import store

NODE_LABELS = {
    "understand": "Understand the requirements",
    "discover_tools": "Discover available tools",
    "plan": "Plan the approach",
    "agent": "Agent reasoning",
    "tools": "Run tools",
    "report": "Write the report",
}

NODE_STATUS = {
    "understand": "ANALYZING",
    "plan": "PLANNING",
    "agent": "SOURCING",
    "report": "REPORTING",
}

UNDERSTAND_SYSTEM = (
    "You are a senior technical recruiter's analyst. Read the job brief and extract structured "
    "recruitment requirements. Separate must-haves (mandatory) from nice-to-haves (preferred). "
    "Think about which alternative job titles real candidates might use. Be faithful to the brief; "
    "do not invent requirements."
)

PLAN_SYSTEM = (
    "You are the planning stage of a candidate-sourcing agent. Given structured requirements and "
    "the tools the agent can call, produce a short numbered plan (4-8 steps). Each step names the "
    "tool it uses (or 'none' for pure reasoning) and its purpose. Plan only with the listed tools."
)

AGENT_SYSTEM = (
    "You are a candidate-sourcing agent working for a human recruiter. Follow the plan, using your "
    "tools to find real, publicly visible professional profiles that match the requirements.\n"
    "Rules:\n"
    "- Collect public professional information only. Never bypass logins or CAPTCHAs.\n"
    "- Never fabricate a candidate or evidence: every candidate needs a source URL you actually saw "
    "in a tool result.\n"
    "- Missing evidence is not negative evidence; list it as missing information.\n"
    "- Unmet mandatory requirements mean 'recruiter review', not rejection.\n"
    "- Before each tool call, say in one short sentence what you are about to do and why.\n"
    "- Record each promising candidate with record_candidate, then score it with score_candidate.\n"
    "- Stop calling tools once the minimum number of candidates is scored, or when searches stop "
    "yielding new people. Then reply with a brief wrap-up (no more tool calls)."
)

REPORT_SYSTEM = (
    "You write the final recruiter briefing for a sourcing campaign. Use only the data given. "
    "Summarise how many candidates were found and their score distribution, highlight the top "
    "candidates with the evidence behind them, state clearly what could not be verified and any "
    "limits of the search, and recommend next steps. Remind the reader that human decisions are final. "
    "Keep it concise, in Markdown."
)

REQUIREMENTS_SCHEMA = {
    "type": "object",
    "properties": {
        "mandatory": {"type": "array", "items": {"type": "string"}},
        "preferred": {"type": "array", "items": {"type": "string"}},
        "technical_skills": {"type": "array", "items": {"type": "string"}},
        "industries": {"type": "array", "items": {"type": "string"}},
        "alternative_titles": {"type": "array", "items": {"type": "string"}},
        "knockout_criteria": {"type": "array", "items": {"type": "string"}},
    },
}

PLAN_SCHEMA = {
    "type": "object",
    "properties": {
        "steps": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "step": {"type": "integer"},
                    "tool": {"type": "string"},
                    "purpose": {"type": "string"},
                },
            },
        }
    },
}


class GraphState(TypedDict, total=False):
    campaign_id: str
    job_title: str
    job_description: str
    location: str
    minimum_candidates: int
    mandatory: list[str]
    preferred: list[str]
    requirements: JobRequirements
    plan_steps: list[dict[str, Any]]
    messages: list[dict[str, Any]]
    iterations: int
    limitation: str


def traced(name: str):
    """Publish node_start / node_end around a node and keep campaign status current."""

    def decorator(fn):
        @wraps(fn)
        async def wrapper(state: GraphState) -> dict:
            cid = state["campaign_id"]
            step = state.get("iterations", 0) + 1 if name == "agent" else None
            bus.publish(cid, {"type": "node_start", "node": name, "step": step,
                              "label": NODE_LABELS[name]})
            if name in NODE_STATUS:
                campaign = store.get(UUID(cid))
                campaign.status = NODE_STATUS[name]
                store.save(campaign)
            result = await fn(state)
            bus.publish(cid, {"type": "node_end", "node": name, "step": step})
            return result

        return wrapper

    return decorator


@traced("understand")
async def understand_node(state: GraphState) -> dict:
    cid = state["campaign_id"]
    message = await stream_claude(
        cid, "understand",
        system=UNDERSTAND_SYSTEM,
        messages=[{"role": "user", "content": json.dumps({
            "job_title": state["job_title"],
            "location": state["location"],
            "job_description": state["job_description"],
            "recruiter_mandatory": state["mandatory"],
            "recruiter_preferred": state["preferred"],
        })}],
        output_schema=REQUIREMENTS_SCHEMA,
        max_tokens=16000,
    )
    if message.stop_reason not in ("end_turn", "stop_sequence"):
        raise RuntimeError(f"Could not extract requirements (stop_reason={message.stop_reason})")
    requirements = JobRequirements(job_title=state["job_title"], **json_of(message))
    campaign = store.get(UUID(cid))
    campaign.requirements = requirements
    store.save(campaign)
    return {"requirements": requirements}


@traced("discover_tools")
async def discover_tools_node(state: GraphState) -> dict:
    tools = catalog()
    bus.publish(state["campaign_id"], {"type": "tools_available", "node": "discover_tools",
                                       "tools": tools})
    return {}


@traced("plan")
async def plan_node(state: GraphState) -> dict:
    cid = state["campaign_id"]
    requirements = state["requirements"]
    message = await stream_claude(
        cid, "plan",
        system=PLAN_SYSTEM,
        messages=[{"role": "user", "content": json.dumps({
            "requirements": requirements.model_dump(exclude={"search_queries"}),
            "location": state["location"],
            "minimum_candidates": state["minimum_candidates"],
            "tools": catalog(),
        })}],
        output_schema=PLAN_SCHEMA,
        max_tokens=16000,
    )
    if message.stop_reason not in ("end_turn", "stop_sequence"):
        raise RuntimeError(f"Could not produce a plan (stop_reason={message.stop_reason})")
    plan = json_of(message)["steps"]
    bus.publish(cid, {"type": "plan", "node": "plan", "steps": plan})
    campaign = store.get(UUID(cid))
    campaign.plan = plan
    store.save(campaign)

    first = {
        "role": "user",
        "content": json.dumps({
            "task": (
                f"Source and score at least {state['minimum_candidates']} candidates for "
                f"'{state['job_title']}' in '{state['location']}'. Follow the plan, then wrap up."
            ),
            "requirements": requirements.model_dump(exclude={"search_queries"}),
            "plan": plan,
        }),
    }
    return {"plan_steps": plan, "messages": [first], "iterations": 0}


@traced("agent")
async def agent_node(state: GraphState) -> dict:
    step = state.get("iterations", 0) + 1
    message = await stream_claude(
        state["campaign_id"], "agent",
        system=AGENT_SYSTEM,
        messages=state["messages"],
        tools=api_tools(),
        step=step,
    )
    update: dict[str, Any] = {
        # Keep the assistant turn exactly as returned (thinking blocks included).
        "messages": state["messages"] + [{"role": "assistant", "content": message.content}],
        "iterations": step,
    }
    if message.stop_reason in ("refusal", "max_tokens"):
        update["limitation"] = f"Agent stopped early (stop_reason={message.stop_reason})."
    return update


def route_after_agent(state: GraphState) -> Literal["tools", "report"]:
    last = state["messages"][-1]["content"]
    wants_tools = any(getattr(b, "type", None) == "tool_use" for b in last)
    if state.get("limitation") or not wants_tools:
        return "report"
    if state["iterations"] >= settings.max_agent_iterations:
        return "report"
    return "tools"


@traced("tools")
async def tools_node(state: GraphState) -> dict:
    cid = state["campaign_id"]
    step = state["iterations"]
    calls = [b for b in state["messages"][-1]["content"] if b.type == "tool_use"]
    for call in calls:
        bus.publish(cid, {"type": "tool_call", "node": "tools", "step": step,
                          "id": call.id, "tool": call.name, "input": call.input})

    outcomes = await asyncio.gather(*(run_tool(cid, c.name, c.input) for c in calls))

    results = []
    for call, (content, is_error) in zip(calls, outcomes):
        bus.publish(cid, {"type": "tool_result", "node": "tools", "step": step,
                          "id": call.id, "tool": call.name, "is_error": is_error,
                          "content": content[:3000]})
        results.append({"type": "tool_result", "tool_use_id": call.id,
                        "content": content, **({"is_error": True} if is_error else {})})
    # All results go back in a single user message.
    return {"messages": state["messages"] + [{"role": "user", "content": results}]}


@traced("report")
async def report_node(state: GraphState) -> dict:
    cid = state["campaign_id"]
    campaign = store.get(UUID(cid))
    by_id = {e.candidate_id: e for e in campaign.evaluations}
    digest = [
        {
            "name": c.name,
            "profile": c.sources[0].url if c.sources else None,
            "title": c.current_title,
            "company": c.current_company,
            "score": by_id[c.id].total_score if c.id in by_id else None,
            "category": by_id[c.id].category if c.id in by_id else "NOT SCORED",
            "strengths": by_id[c.id].strengths if c.id in by_id else [],
            "gaps": by_id[c.id].weaknesses + by_id[c.id].knockout_findings if c.id in by_id else [],
        }
        for c in campaign.candidates
    ]
    note = state.get("limitation", "")
    if state.get("iterations", 0) >= settings.max_agent_iterations:
        note = (note + " Reached the agent step limit.").strip()
    message = await stream_claude(
        cid, "report",
        system=REPORT_SYSTEM,
        messages=[{"role": "user", "content": json.dumps({
            "job_title": campaign.job_title,
            "minimum_candidates": campaign.minimum_candidates,
            "candidates": digest,
            "search_limitations": note,
        })}],
        max_tokens=16000,
    )
    campaign.summary = text_of(message)
    campaign.limitation = note
    campaign.status = "COMPLETED"
    store.save(campaign)
    return {"limitation": note}


def build_graph():
    graph = StateGraph(GraphState)
    graph.add_node("understand", understand_node)
    graph.add_node("discover_tools", discover_tools_node)
    graph.add_node("plan", plan_node)
    graph.add_node("agent", agent_node)
    graph.add_node("tools", tools_node)
    graph.add_node("report", report_node)

    graph.add_edge(START, "understand")
    graph.add_edge("understand", "discover_tools")
    graph.add_edge("discover_tools", "plan")
    graph.add_edge("plan", "agent")
    graph.add_conditional_edges("agent", route_after_agent, {"tools": "tools", "report": "report"})
    graph.add_edge("tools", "agent")
    graph.add_edge("report", END)
    return graph.compile()


workflow = build_graph()
