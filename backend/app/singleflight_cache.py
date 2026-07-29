from __future__ import annotations

from concurrent.futures import Future
from copy import deepcopy
from threading import Lock
from time import monotonic
from typing import Any, Callable, Hashable


class SingleflightTTLCache:
    """Small in-process cache that computes each live key at most once."""

    def __init__(self) -> None:
        self._lock = Lock()
        self._values: dict[Hashable, tuple[float, Any]] = {}
        self._failures: dict[Hashable, tuple[float, BaseException]] = {}
        self._inflight: dict[Hashable, Future[Any]] = {}

    def get_or_compute(
        self,
        key: Hashable,
        compute: Callable[[], Any],
        *,
        success_ttl_seconds: float,
        failure_ttl_seconds: float = 5.0,
    ) -> Any:
        now = monotonic()
        with self._lock:
            cached = self._values.get(key)
            if cached and cached[0] > now:
                return deepcopy(cached[1])
            failed = self._failures.get(key)
            if failed and failed[0] > now:
                raise RuntimeError(str(failed[1])) from failed[1]
            future = self._inflight.get(key)
            owner = future is None
            if future is None:
                future = Future()
                self._inflight[key] = future

        if not owner:
            return deepcopy(future.result())

        try:
            value = compute()
        except BaseException as exc:
            with self._lock:
                self._failures[key] = (monotonic() + failure_ttl_seconds, exc)
                self._inflight.pop(key, None)
                future.set_exception(exc)
                # The owner raises directly; mark the Future exception observed.
                future.exception()
            raise

        with self._lock:
            self._values[key] = (monotonic() + success_ttl_seconds, deepcopy(value))
            self._failures.pop(key, None)
            self._inflight.pop(key, None)
            future.set_result(deepcopy(value))
        return value

    def clear(self) -> None:
        with self._lock:
            self._values.clear()
            self._failures.clear()
