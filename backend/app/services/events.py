"""In-process event bus that powers the live agent view (SSE)."""
from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any
from uuid import UUID

# Streaming deltas are broadcast live but not persisted: the consolidated
# `block_end` event carries the full text and is what gets replayed.
TRANSIENT_TYPES = {"thinking_delta", "text_delta"}


class EventBus:
    def __init__(self) -> None:
        self._history: dict[str, list[dict[str, Any]]] = {}
        self._subscribers: dict[str, set[asyncio.Queue]] = {}
        self._seq: dict[str, int] = {}

    def reset(self, campaign_id: str | UUID) -> None:
        key = str(campaign_id)
        self._history[key] = []
        self._seq[key] = 0

    def publish(self, campaign_id: str | UUID, event: dict[str, Any]) -> dict[str, Any]:
        key = str(campaign_id)
        self._seq[key] = self._seq.get(key, 0) + 1
        event = {
            "seq": self._seq[key],
            "timestamp": datetime.utcnow().isoformat(),
            **event,
        }
        if event.get("type") not in TRANSIENT_TYPES:
            self._history.setdefault(key, []).append(event)
        for queue in list(self._subscribers.get(key, ())):
            queue.put_nowait(event)
        return event

    def history(self, campaign_id: str | UUID) -> list[dict[str, Any]]:
        return list(self._history.get(str(campaign_id), []))

    def subscribe(self, campaign_id: str | UUID) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        self._subscribers.setdefault(str(campaign_id), set()).add(queue)
        return queue

    def unsubscribe(self, campaign_id: str | UUID, queue: asyncio.Queue) -> None:
        self._subscribers.get(str(campaign_id), set()).discard(queue)


bus = EventBus()
