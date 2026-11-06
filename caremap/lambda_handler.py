"""Lambda Function URL handler, wrapping caremap.agents.handle_message.

Enforces the hard rules a Function URL doesn't give you for free (no API
Gateway in front, so no built-in rate limiting / WAF / request validation):
a CORS allow-list, a max message length, and a per-IP rate limit.

The rate limit is deliberately simple: an in-memory sliding window, scoped
to one warm execution environment. It resets on cold start and isn't a
global limit across concurrent environments -- acceptable for a $0,
no-database hackathon project with modest traffic, not a production
guarantee. Document this if traffic ever grows enough to matter.
"""
from __future__ import annotations

import json
import os
import re
import time
from collections import defaultdict, deque

from .agents import build_orchestrator, handle_message, make_model

MAX_MESSAGE_LENGTH = int(os.getenv("CAREMAP_MAX_MESSAGE_LENGTH", "500"))
RATE_LIMIT_PER_MINUTE = int(os.getenv("CAREMAP_RATE_LIMIT_PER_MINUTE", "20"))
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("CAREMAP_ALLOWED_ORIGINS", "").split(",") if o.strip()]

# Warm-container-scoped state. Reset on cold start; not shared across
# concurrent execution environments (see module docstring).
_request_times: dict[str, deque] = defaultdict(deque)
# Only the model client is reused across requests. The agent itself must be
# rebuilt for every request: a Strands Agent keeps its message history (and
# the evidence ledger its numbers), so a shared one leaked one user's
# conversation into the next user's answers and loosened the grounding check.
_model = None  # built lazily so import-time failures don't break cold start diagnostics


def _cors_headers(origin: str | None) -> dict:
    if origin and origin in ALLOWED_ORIGINS:
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Vary": "Origin",
        }
    return {}


def no_em_dashes(text: str) -> str:
    """CareMap's style bans em-dashes (and the "--" stand-in, which reads as
    a typo); the model still emits them sometimes."""
    return re.sub(r"\s*\u2014\s*|\s+--\s+", ", ", text)


def _rate_limited(source_ip: str) -> bool:
    now = time.time()
    window = _request_times[source_ip]
    while window and now - window[0] > 60:
        window.popleft()
    if len(window) >= RATE_LIMIT_PER_MINUTE:
        return True
    window.append(now)
    return False


def _response(status: int, body: dict, origin: str | None) -> dict:
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json", **_cors_headers(origin)},
        "body": json.dumps(body),
    }


def handler(event: dict, context) -> dict:  # noqa: ARG001 (context required by Lambda)
    global _model

    http = event.get("requestContext", {}).get("http", {})
    method = http.get("method", "POST")
    source_ip = http.get("sourceIp", "unknown")
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    origin = headers.get("origin")

    if method == "OPTIONS":
        return _response(204, {}, origin)

    if origin and ALLOWED_ORIGINS and origin not in ALLOWED_ORIGINS:
        return _response(403, {"error": "origin not allowed"}, origin)

    if _rate_limited(source_ip):
        return _response(429, {"error": "rate limit exceeded, try again shortly"}, origin)

    try:
        payload = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _response(400, {"error": "invalid JSON body"}, origin)

    # Sent once when the page opens, so the first real question doesn't
    # also pay for a cold start. Never calls the model.
    if payload.get("warmup") is True:
        if _model is None:
            _model = make_model()
        return _response(200, {"ok": True}, origin)

    message = payload.get("message", "")
    if not isinstance(message, str) or not message.strip():
        return _response(400, {"error": "message is required"}, origin)
    if len(message) > MAX_MESSAGE_LENGTH:
        return _response(400, {"error": f"message exceeds {MAX_MESSAGE_LENGTH} characters"}, origin)

    if _model is None:
        _model = make_model()
    orchestrator = build_orchestrator(model=_model)

    zip_code = payload.get("zipCode")
    insurance_type = payload.get("insuranceType")
    veteran = payload.get("veteran")
    tier_pct = payload.get("tierPct")
    fpl_pct = payload.get("fplPct")
    need = payload.get("need")
    _valid_insurance_types = {"uninsured", "medicaid", "medicare", "private", "va_tricare", "unsure"}

    try:
        result = handle_message(
            message, orchestrator=orchestrator,
            zip_code=zip_code if isinstance(zip_code, str) else None,
            insurance_type=insurance_type if insurance_type in _valid_insurance_types else None,
            veteran=veteran if isinstance(veteran, bool) else None,
            tier_pct=tier_pct if isinstance(tier_pct, (int, float)) else None,
            fpl_pct=fpl_pct if isinstance(fpl_pct, (int, float)) else None,
            need=need.strip()[:80] if isinstance(need, str) and need.strip() else None,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"handle_message failed: {exc!r}")
        return _response(502, {"error": "agent failed, try again"}, origin)

    return _response(200, {"reply": no_em_dashes(result["reply"]), "map_commands": result["map_commands"]}, origin)
