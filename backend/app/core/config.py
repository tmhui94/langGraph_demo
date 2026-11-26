from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_env: str = "development"
    database_url: str = "postgresql+asyncpg://hragent:hragent@localhost:5432/hragent"
    claude_api_model: str = "claude-opus-5-5"
    claude_effort: str = "medium"
    max_agent_iterations: int = 40
    # Rounds in a row the agent may be sent back to search again without scoring anyone new.
    max_search_retries: int = 4
    anthropic_api_key: str = ""
    search_provider: str = "serper"
    serper_api_key: str = ""
    tavily_api_key: str = ""
    github_token: str = ""
    max_candidates: int = 20
    search_concurrency: int = 4
    candidate_research_concurrency: int = 3
    cors_origins: str = "http://localhost:5173"

    class Config:
        env_file = ".env"


settings = Settings()
