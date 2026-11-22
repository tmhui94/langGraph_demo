"""Claude access for the agent: one streaming wrapper that publishes reasoning live."""
from __future__ import annotations

import json
from typing import Any

import anthropic

from app.core.config import settings
from app.services.events import bus


class LLMNotConfigured(RuntimeError):
    pass


_client: anthropic.AsyncAnthropic | None = None


def get_client() -> anthropic.AsyncAnthropic:
    global _client
    if not settings.anthropic_api_key:
        raise LLMNotConfigured(
            "ANTHROPIC_API_KEY is not set. This demo needs Claude to understand the job, "
            "plan, and choose tools; add the key to .env and restart the backend."
        )
    if _client is None:
        _client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _client


def strictify(schema: dict[str, Any]) -> dict[str, Any]:
    """Make a JSON schema acceptable for structured outputs / strict tools."""
    if isinstance(schema, dict):
        out = {k: strictify(v) for k, v in schema.items()}
        if out.get("type") == "object":
            out["additionalProperties"] = False
            out.setdefault("properties", {})
            out["required"] = list(out["properties"].keys())
        return out
    if isinstance(schema, list):
        return [strictify(v) for v in schema]
    return schema


# Models released before adaptive thinking (Claude 4.6). They take a fixed thinking budget,
# and only Opus 4.5 accepts `effort`.
LEGACY_MODEL_PREFIXES = (
    "claude-3", "claude-sonnet-4-5", "claude-haiku-4-5", "claude-opus-4-5",
    "claude-opus-4-1", "claude-opus-4-0", "claude-sonnet-4-0",
    "claude-opus-4-2025", "claude-sonnet-4-2025",
)


def is_legacy_model(model: str) -> bool:
    return model.startswith(LEGACY_MODEL_PREFIXES)


def thinking_options(model: str, max_tokens: int) -> dict[str, Any]:
    """Thinking / effort / fallback parameters that the given model accepts."""
    if is_legacy_model(model):
        options: dict[str, Any] = {
            # Older models return summarized thinking by default.
            "thinking": {"type": "enabled", "budget_tokens": min(8000, max_tokens - 1024)},
        }
        if model.startswith("claude-opus-4-5") and settings.claude_effort in ("low", "medium", "high"):
            options["output_config"] = {"effort": settings.claude_effort}
        return options
    return {
        # display="summarized" makes the reasoning readable; the default is empty text.
        "thinking": {"type": "adaptive", "display": "summarized"},
        "output_config": {"effort": settings.claude_effort},
        # If Claude declines, the API retries on a suitable fallback model in the same call.
        "betas": ["server-side-fallback-2026-07-01"],
        "fallbacks": "default",
    }


async def stream_claude(
    campaign_id: str,
    node: str,
    *,
    system: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
    output_schema: dict[str, Any] | None = None,
    max_tokens: int = 32000,
    step: int | None = None,
):
    """Call Claude with adaptive thinking and publish every block to the event bus.

    Returns the final BetaMessage. Callers must check `stop_reason`.
    """
    client = get_client()
    model = settings.claude_api_model
    kwargs: dict[str, Any] = dict(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=messages,
        **thinking_options(model, max_tokens),
    )
    if output_schema is not None:
        kwargs.setdefault("output_config", {})["format"] = {
            "type": "json_schema", "schema": strictify(output_schema),
        }
    if tools:
        kwargs["tools"] = tools

    buffers: dict[int, str] = {}
    kinds: dict[int, str] = {}

    async with client.beta.messages.stream(**kwargs) as stream:
        async for event in stream:
            if event.type == "content_block_start":
                index = event.index
                kind = event.content_block.type
                kinds[index] = kind
                buffers[index] = ""
                if kind in ("thinking", "text", "tool_use"):
                    bus.publish(campaign_id, {
                        "type": "block_start", "node": node, "step": step, "block": index, "kind": kind,
                        "tool": getattr(event.content_block, "name", None),
                    })
            elif event.type == "content_block_delta":
                index = event.index
                delta = event.delta
                if delta.type == "thinking_delta":
                    buffers[index] = buffers.get(index, "") + delta.thinking
                    bus.publish(campaign_id, {
                        "type": "thinking_delta", "node": node, "step": step, "block": index, "delta": delta.thinking,
                    })
                elif delta.type == "text_delta":
                    buffers[index] = buffers.get(index, "") + delta.text
                    bus.publish(campaign_id, {
                        "type": "text_delta", "node": node, "step": step, "block": index, "delta": delta.text,
                    })
            elif event.type == "content_block_stop":
                index = event.index
                kind = kinds.get(index)
                if kind in ("thinking", "text"):
                    bus.publish(campaign_id, {
                        "type": "block_end", "node": node, "step": step, "block": index, "kind": kind,
                        "text": buffers.get(index, ""),
                    })
        final = await stream.get_final_message()

    if final.stop_reason == "refusal":
        bus.publish(campaign_id, {
            "type": "error", "node": node, "step": step,
            "detail": "Claude declined this request (refusal).",
        })
    return final


def text_of(message) -> str:
    return "".join(b.text for b in message.content if b.type == "text")


def json_of(message) -> dict[str, Any]:
    return json.loads(text_of(message))
