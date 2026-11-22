# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

AI-powered HR sourcing agent: a FastAPI backend runs a LangGraph `StateGraph` that turns a job description into requirements, search queries, sourced public professional profiles, and weighted evaluations. A React/TypeScript/MUI dashboard (`frontend/`) drives it. PostgreSQL stores campaign snapshots.

## Commands

Full stack (Postgres + backend + frontend):

```powershell
docker compose up --build    # UI http://localhost:5173, API docs http://localhost:8000/docs
```

Backend local dev (run from `backend/` so `app.*` imports and `.env` resolve):

```powershell
cd backend
python -m venv .venv; .\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Frontend (from `frontend/`): `npm install`, `npm run dev`, `npm run build` (runs `tsc -b` type-check, then `vite build`).

There is no test suite, linter, or formatter configured. `npm run build` is the only automated check (TypeScript).

### Local-dev gotchas
- `frontend/vite.config.ts` proxies `/api` to `http://backend:8000` (the Docker service name). When running the frontend outside Docker, that target must be `http://localhost:8000`.
- `Settings` reads `.env` relative to the working directory; the repo's `.env` is at the root, so a backend started from `backend/` won't see it unless env vars are exported or the file is copied.
- `backend/alembic.ini` uses an `asyncpg` URL while `alembic/env.py` uses a sync engine. Tables are actually created at startup through `Base.metadata.create_all` in `app/db.py`.

## Configuration

All settings are in `backend/app/core/config.py` (pydantic-settings, env var names match the field names uppercased). See `.env.example`. Key ones:
- `ANTHROPIC_API_KEY`, `CLAUDE_API_MODEL`: enable Claude for JD analysis and the search-planning tool loop.
- `SEARCH_PROVIDER` (`serper` | `tavily` | `github`), together with `SERPER_API_KEY`, `TAVILY_API_KEY`, and the optional `GITHUB_TOKEN`.

Without keys the system still runs. It uses deterministic fallbacks and reports a `limitation` string. **It must never fabricate candidates.**

## Architecture

Request flow: `POST /api/campaigns` creates a campaign. `POST /api/campaigns/{id}/start` builds the initial `GraphState` and **awaits `workflow.ainvoke` synchronously**, so the request blocks until the whole graph finishes. `GET .../events` is an SSE endpoint, but it only replays the events already stored on the campaign. It does not stream live progress.

### LangGraph (`backend/app/graph/workflow.py`)
- `GraphState` is a `TypedDict`. Only `events` has a reducer (`merge_events`, which appends). Every other key is overwritten by whichever node returns it.
- Node order: `analyze → generate_queries → source ⇄ expand (conditional count_check) → candidate_intelligence → resume_acquisition → evaluate → quality_assurance → report`.
- `count_check` stops expanding when any of these holds: the minimum number of candidates is reached, `search_attempts >= retry_limit`, or any provider `limitation` is set.
- `docs/langgraph-workflow.md` describes a QA→intelligence retry loop and a categorisation node. In the code, `quality_assurance → report` is a plain edge, and categorisation happens inside `evaluate_candidate`. `dispatch_research` (a `Send` fan-out) is defined but not wired into the graph.
- Nodes have a side effect: they write progress straight to the `store` singleton (`store.get` / `store.save`) and also return state updates. When you change a node, keep both in sync.
- `extract_candidate` accepts only results from allowlisted hosts (linkedin, github, jobstreet, indeed, glassdoor, and hosts containing "profiles" or "portfolio"). It parses the candidate name from the result title.
- Scoring is keyword matching against the requirements, weighted by `ScoringWeights`. The total sets the category: ≥80 HIGH, ≥60 MEDIUM, otherwise LOW. Unmet mandatory requirements set `recruiter_review_required` and do **not** auto-reject.

### Services (`backend/app/services/`)
- `llm.py` calls the Anthropic Messages API directly over `httpx`, without the SDK. `analyze_job_description` asks for JSON and normalizes it with `_string_items`, which forces list entries to strings. `generate_claude_search_plan` runs a tool-use loop of up to 3 turns with a `search_professional_profiles` tool that calls `search_web`. Every Claude path catches exceptions and falls back to deterministic logic.
- `search.py`: `search_web(query, limit)` returns `(results, limitation)`, where `results` is a list of `{url, title, excerpt}` dicts. The provider is chosen by `SEARCH_PROVIDER` together with whether its key is present.
- `store.py`: `CampaignStore` uses an **in-memory dict as the source of truth for reads**. It also upserts a JSON snapshot into the `campaign_snapshots` table on each save, and silently swallows DB errors. Campaigns are lost on restart because nothing reloads them from Postgres.

### Schemas
`backend/app/schemas.py` (Pydantic) is mirrored by hand in `frontend/src/api.ts`. Update both when you change the API shape. The frontend is essentially one component, `frontend/src/App.tsx`.

## Data principles (from README)

Collect professional recruiting info only, from permitted providers. Preserve source URLs and retrieval timestamps (`SourceReference`). Never bypass logins, CAPTCHAs, or access controls. Treat missing evidence as distinct from negative evidence. Human recruiter decisions stay final.
