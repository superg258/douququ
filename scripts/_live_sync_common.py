from __future__ import annotations

import json
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def fetch_json(
    url: str,
    previous_headers: dict[str, str] | None = None,
    *,
    user_agent: str,
    require_object: bool = False,
) -> tuple[Any | None, dict[str, str], bool]:
    previous_headers = previous_headers or {}
    request_headers = {"User-Agent": user_agent}
    if previous_headers.get("etag"):
        request_headers["If-None-Match"] = str(previous_headers["etag"])
    if previous_headers.get("last-modified"):
        request_headers["If-Modified-Since"] = str(previous_headers["last-modified"])
    try:
        with urlopen(Request(url, headers=request_headers), timeout=30) as response:  # noqa: S310
            headers = {key.lower(): value for key, value in response.headers.items()}
            payload = json.loads(response.read().decode("utf-8"))
            if require_object and not isinstance(payload, dict):
                raise ValueError("Upstream response must be a JSON object")
            return payload, headers, True
    except HTTPError as exc:
        if exc.code == 304:
            return None, dict(previous_headers), False
        raise
