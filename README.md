# AI-Powered HR Sourcing & Candidate Intelligence Agent

A working demonstration of LangGraph-driven professional candidate sourcing.
The system submits a job description, generates structured requirements and search
queries, executes configured permitted search providers, deduplicates public
professional profiles, evaluates source-backed evidence, and presents recruiter
results through React/MUI.

## Stack

- Python 3.12, FastAPI, Pydantic
- LangGraph and LangChain
- PostgreSQL and SQLAlchemy
- React, TypeScript, MUI, MUI DataGrid, Recharts
- Docker Compose

## Run

1. Copy `.env.example` to `.env`.
2. Add an Anthropic Claude key and/or Serper, Tavily, or GitHub search configuration for live use.
3. Start services:

```powershell
docker compose up --build
```

4. Open `http://localhost:5173`.
5. The backend is available at `http://localhost:8000/docs`.

For local development:

```powershell
cd backend
python -m venv .venv
.\\.venv\\Scripts\\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

In another terminal:

```powershell
cd frontend
npm install
npm run dev
```

## Live Search Configuration

Set one search provider:

- `SERPER_API_KEY`
- `TAVILY_API_KEY`
- `SEARCH_PROVIDER=github` for the public GitHub user search

`GITHUB_TOKEN` is optional. When set, it authenticates GitHub API requests, raises
the available API rate limit, and enables search access for authenticated requests.
GitHub public profile URLs are used as candidate sources; private repository data
and private user information are never accessed.

`ANTHROPIC_API_KEY` is **required**: Claude understands the job, plans, chooses which tools to call
and scores candidates. Without it a run stops immediately with an error instead of faking results.
Defaults: `CLAUDE_API_MODEL=claude-opus-5-5`, `CLAUDE_EFFORT=medium` (`low` to `max`; lower is cheaper
and faster), `MAX_AGENT_ITERATIONS=40` (cap on agent/tool steps), `MAX_SEARCH_RETRIES=4` (retry rounds in a
row that find nobody new before the agent may stop short of the requested candidate count).

## Demo flow: Prompt, Live, Results

1. **Prompt:** type a request in your own words. The agent pulls out the job title, location, how many
   candidates and the must-haves.
2. **Live:** watch it understand, plan, search, read, record and score, with its reasoning streaming in.
3. **Results:** a ranked shortlist and briefing. Rate the run, and if you like it, **save it as an agent**.
   The agent keeps the steps it worked out and asks only for the inputs that change.

Saved agents appear under **My agents** on the Prompt step (stored in the browser). Running one sends the
saved requirements and plan to the backend (`saved_requirements`, `saved_plan`), so the Understand and
Plan steps are reused with **no AI call**. Only the search loop and the report use the AI again.
If you change the **job title or must-haves**, the saved steps no longer fit the role, so the run is
**adapted** instead: Understand and Plan call the AI again, starting from the saved versions (`adapt: true`).
Changing only the location or the number of candidates keeps the full reuse.

## How the agent works (the demo)

The **Live Execution** tab shows the LangGraph run as it happens:

1. **Understand**: Claude extracts structured requirements from the job description.
2. **Discover tools**: the agent lists the tools it can call.
3. **Plan**: Claude plans how to use those tools to meet the requirements.
4. **Act**: a loop of reasoning, tool call and observation (search, read a public profile, record and
   score a candidate) until enough candidates are scored or searches dry up.
5. **Report**: Claude writes the recruiter briefing.

Claude's summarized reasoning streams into each step (the "Reasoning" panels), and every tool call
and its observation is shown. See `docs/langgraph-workflow.md`.

With `SEARCH_PROVIDER=github` the agent uses GitHub user-search qualifiers such as
`location:malaysia language:csharp`.

## Demo Scenario

The campaign form starts with:

- Job: Software Engineer
- Location: Kajang / Selangor, Malaysia
- C#/.NET, React or Angular, SQL Server, REST APIs, Docker
- Preferred: microservices, Azure, CI/CD, IoT

## Safety and Data Principles

- Collect professional recruiting information only.
- Preserve source URLs and retrieval timestamps.
- Do not bypass logins, CAPTCHAs, or access controls.
- Distinguish missing evidence from negative evidence.
- Mandatory requirement misses trigger recruiter review rather than automatic rejection.
- Human decisions remain final.
