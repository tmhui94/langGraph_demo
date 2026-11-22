# LangGraph Workflow

```mermaid
flowchart TD
  START --> A[Job Description Analysis]
  A --> Q[Search Query Generation]
  Q --> S[Candidate Sourcing]
  S --> C{Candidate Count and Provider Limits}
  C -->|Below minimum| X[Expand Search]
  X --> S
  C -->|Minimum reached or exhausted| I[Candidate Intelligence]
  I --> R[Resume Acquisition]
  R --> E[Candidate Evaluation]
  E --> QA[Quality Assurance]
  QA -->|Errors and attempts remain| I
  QA -->|Pass| CAT[Candidate Categorisation]
  CAT --> REPORT[Report Generation]
  REPORT --> END
```

The implementation is a real LangGraph StateGraph with typed state, conditional retry routing,
bounded search attempts, checkpoint-ready state, and actual provider calls. Search-provider
credentials are required for live results. No candidate is fabricated when no provider is configured
or when source coverage is exhausted.
