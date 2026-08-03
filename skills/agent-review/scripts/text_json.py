"""JSON-object extraction shared by schema-less text-output adapters."""

from __future__ import annotations

import json
from typing import Any


def parse_json_object(text: str) -> dict[str, Any]:
    """Parse a bare, fenced, or prose-wrapped JSON object.

    Direct JSON remains the strict fast path. When a model surrounds the object
    with prose, scan every object start with the standard decoder and return the
    largest decodable object. The core still owns review-schema normalization.
    """
    stripped = _strip_code_fence(text)
    try:
        payload = json.loads(stripped)
    except json.JSONDecodeError as direct_error:
        decoder = json.JSONDecoder()
        candidates: list[tuple[int, int, dict[str, Any]]] = []
        for start, character in enumerate(stripped):
            if character != "{":
                continue
            try:
                value, end = decoder.raw_decode(stripped, start)
            except json.JSONDecodeError:
                continue
            if isinstance(value, dict):
                candidates.append((end - start, end, value))
        if not candidates:
            raise direct_error
        return max(candidates, key=lambda candidate: (candidate[0], candidate[1]))[2]

    if not isinstance(payload, dict):
        raise ValueError("text payload is not a JSON object")
    return payload


def _strip_code_fence(text: str) -> str:
    stripped = text.strip()
    if not stripped.startswith("```"):
        return stripped
    lines = stripped.splitlines()[1:]
    if lines and lines[-1].strip().startswith("```"):
        lines = lines[:-1]
    return "\n".join(lines).strip()
