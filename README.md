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

Set `ANTHROPIC_API_KEY` and optionally `CLAUDE_API_MODEL` for Claude-based JD extraction
and candidate/evaluation assistance. The default model is `claude-sonnet-4-5`.
Without provider keys, the system performs no fabrication and reports that live search
was unavailable.

The LangGraph search-query stage uses Claude's tool-use feature. Claude receives a
`search_professional_profiles` tool, requests permitted searches, receives provider
result summaries, and then returns the final query list. LangGraph executes that tool
loop and the actual provider calls. The live execution event identifies when Claude
selected queries using tools.

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
