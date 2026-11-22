# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A LangGraph **teaching demo**: an AI sourcing agent that understands a job brief, discovers its tools, plans, then loops (reason, call a tool, observe) to find and score public professional profiles, and writes a report. The point is to let an audience *watch the agent think*, so every LLM call streams its summarized reasoning to the UI. FastAPI backend (`backend/`), React/TypeScript/MUI frontend (`frontend/`), PostgreSQL for campaign snapshots.

## Commands

Full stack (Postgres + backend + frontend):

```powershell
docker compose up --build    # UI http://localhost:5173, API docs http://localhost:8000/docs
```

Backend local dev (run from `backend/` so `app.*` imports resolve):

```powershell
cd backend
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Frontend (from `frontend/`): `npm install`, `npm run dev`, `npm run build` (runs `tsc -b`, then `vite build`).

There is no test suite, linter or formatter. `npm run build` (TypeScript) and compiling the graph are the only automated checks:

```powershell
cd backend; python -c "from app.graph.workflow import workflow; print(workflow.get_graph().draw_mermaid())"
```

### Local-dev gotchas
- `frontend/vite.config.ts` proxies `/api` to `http://backend:8000` (the Docker service name). Outside Docker it must be `http://localhost:8000`.
- `Settings` reads `.env` relative to the working directory. The repo's `.env` is at the root, so a backend started from `backend/` won't see it. Export the variables, or run from the root with `uvicorn app.main:app --app-dir backend`.
- Without Postgres, `store.save` still works (DB errors are swallowed) but each save waits for a connection timeout, so runs are slower.
- `backend/alembic.ini` uses an `asyncpg` URL while `alembic/env.py` uses a sync engine. Tables are actually created at startup via `Base.metadata.create_all` in `app/db.py`.

## Configuration

Settings are in `backend/app/core/config.py` (pydantic-settings; env names = field names uppercased). See `.env.example`.
- `ANTHROPIC_API_KEY` is **required**. There are no deterministic fallbacks: with no key, a run ends in `FAILED` with an `error` event.
- `CLAUDE_API_MODEL` (default `claude-opus-5-5`), `CLAUDE_EFFORT` (`low`..`max`, default `medium`), `MAX_AGENT_ITERATIONS` (default 12).
- `SEARCH_PROVIDER` (`serper` | `tavily` | `github`) with the matching key. `github` needs no key (optional `GITHUB_TOKEN` for rate limits).

## Architecture

### Run lifecycle
`POST /api/campaigns/{id}/start` resets the campaign, launches `run_campaign` as a background `asyncio` task (`app/main.py`) and returns immediately. `GET .../events` is Server-Sent Events: it replays stored history, then streams live events until `done`. The UI folds those events into run state in `frontend/src/useAgentRun.ts` (reducer plus derived candidates, plan progress and stage status). Three views render it: `views/BriefView.tsx` (start a run, My agents), `views/LiveView.tsx` (route rail, thought stream, shortlist board) and `views/ResultsView.tsx` (ranked shortlist, report, feedback). Theme and the highlighter/pin animations live in `theme.ts` and `styles.css`.

### LangGraph (`backend/app/graph/workflow.py`)
`understand → discover_tools → plan → agent ⇄ tools → report`.
- `agent` makes one streamed Claude call with the tool list. `route_after_agent` sends the run to `tools` while Claude emits `tool_use` blocks, and to `report` when it doesn't, hits `MAX_AGENT_ITERATIONS`, or stops with `refusal`/`max_tokens`. Claude decides what to call; the graph only enforces limits.
- `tools` runs all `tool_use` blocks concurrently and returns **all** results in a single user message (`is_error: True` for failures).
- `GraphState.messages` holds the Anthropic conversation. Assistant turns are stored exactly as returned (thinking blocks included); don't strip or rewrite them.
- A node name must not equal a state key (LangGraph raises), which is why the plan is stored as `plan_steps`.
- `traced(...)` wraps each node to publish `node_start`/`node_end` and update `campaign.status`. The graph is invoked with `recursion_limit=100` because the loop needs more than the default 25 supersteps.
- Nodes also write progress to the `store` singleton, so keep state updates and `store.save` in sync.

### Claude access (`backend/app/services/llm.py`)
`stream_claude(...)` is the single entry point: official `anthropic` SDK, `client.beta.messages.stream`, adaptive thinking with `display: "summarized"` (the default display is empty text, which would hide the reasoning), `output_config.effort`, optional JSON-schema structured output, and `server-side-fallback` so a refusal falls back to another model. It publishes `block_start`, `thinking_delta`, `text_delta` and `block_end` events. Always check the returned `stop_reason`. `strictify()` makes schemas valid for structured outputs and `strict` tools.

### Tools (`backend/app/graph/tools.py`)
One `TOOLS` registry feeds both the API `tools=[...]` (`api_tools()`) and the UI catalog (`catalog()`): `search_professional_profiles`, `fetch_public_profile` (GitHub API or public pages, SSRF-guarded, login walls refused), `record_candidate`, `score_candidate`. Claude supplies per-criterion 0-100 scores and evidence; the server applies `ScoringWeights` and computes the total and band (≥80 HIGH, ≥60 MEDIUM, else LOW). Unmet mandatory requirements set `recruiter_review_required` and never auto-reject. The search tool's description changes with `SEARCH_PROVIDER` (GitHub needs `location:`/`language:` qualifiers). Add a new tool by appending an entry here; the UI picks it up automatically.

### Events (`backend/app/services/events.py`)
In-process `EventBus`: per-campaign history plus subscriber queues. Token deltas are broadcast live but not stored; the consolidated `block_end` carries the full text for replay. Events are lost on restart, like campaigns.

### Store and schemas
`CampaignStore` (`services/store.py`) is an in-memory dict that is the source of truth for reads, with best-effort JSON snapshots upserted to Postgres. Nothing reloads from Postgres at startup. `backend/app/schemas.py` is mirrored by hand in `frontend/src/api.ts` (including `AgentEvent`); update both when the API shape changes.

## Data principles (from README)

Collect professional recruiting info only, from permitted providers. Preserve source URLs and retrieval timestamps. Never bypass logins, CAPTCHAs or access controls. Never fabricate candidates; missing evidence is not negative evidence. Human recruiter decisions stay final.
