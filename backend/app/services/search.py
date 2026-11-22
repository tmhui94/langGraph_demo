from __future__ import annotations

from typing import Any

import httpx

from app.core.config import settings


async def search_web(query: str, limit: int = 10) -> tuple[list[dict[str, Any]], str]:
    if settings.serper_api_key and settings.search_provider.lower() == "serper":
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                "https://google.serper.dev/search",
                headers={"X-API-KEY": settings.serper_api_key, "Content-Type": "application/json"},
                json={"q": query, "num": limit},
            )
            response.raise_for_status()
            data = response.json()
            results = [
                {"url": item.get("link", ""), "title": item.get("title", ""), "excerpt": item.get("snippet", "")}
                for item in data.get("organic", [])
                if item.get("link")
            ]
            return results, ""

    if settings.tavily_api_key and settings.search_provider.lower() == "tavily":
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                "https://api.tavily.com/search",
                json={"api_key": settings.tavily_api_key, "query": query, "max_results": limit},
            )
            response.raise_for_status()
            results = [
                {"url": item.get("url", ""), "title": item.get("title", ""), "excerpt": item.get("content", "")}
                for item in response.json().get("results", [])
                if item.get("url")
            ]
            return results, ""

    if settings.search_provider.lower() == "github":
        async with httpx.AsyncClient(timeout=30) as client:
            headers = {
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            }
            if settings.github_token:
                headers["Authorization"] = f"Bearer {settings.github_token}"
            response = await client.get(
                "https://api.github.com/search/users",
                headers=headers,
                params={"q": query, "per_page": limit},
            )
            response.raise_for_status()
            results = [
                {
                    "url": item.get("html_url", ""),
                    "title": item.get("login", ""),
                    "excerpt": "Public GitHub professional profile",
                }
                for item in response.json().get("items", [])
                if item.get("html_url")
            ]
            return results, ""

    return [], (
        "No live search provider was configured. Set SERPER_API_KEY, TAVILY_API_KEY, "
        "or set SEARCH_PROVIDER=github to use the permitted GitHub public search."
    )
