# Architecture

```mermaid
flowchart LR
  R[React MUI Dashboard] -->|REST| A[FastAPI]
  R <-->|SSE live events| A
  A --> G[LangGraph StateGraph]
  G --> N1[understand]
  G --> N2[discover_tools]
  G --> N3[plan]
  G --> N4[agent and tools loop]
  G --> N5[report]
  N1 --> L[Claude via anthropic SDK<br/>adaptive thinking, streamed]
  N3 --> L
  N4 --> L
  N5 --> L
  N4 --> TL[Tools: search, fetch profile,<br/>record candidate, score candidate]
  TL --> P[Search Provider Adapters]
  G --> EB[Event bus]
  EB --> A
  G --> DB[(PostgreSQL Snapshots)]
```

- `POST /api/campaigns/{id}/start` launches the graph as a background task and returns at once.
- Every LLM call publishes reasoning, text and tool activity to an in-process event bus
  (`backend/app/services/events.py`); `GET /api/campaigns/{id}/events` replays the history and then
  streams live events as Server-Sent Events.
- Campaigns are held in memory (`CampaignStore`) with best-effort JSON snapshots in PostgreSQL.
