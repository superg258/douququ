from __future__ import annotations

from collections import OrderedDict
from concurrent.futures import Future
from copy import deepcopy
from threading import Lock
from time import monotonic
from typing import Any, Callable, Hashable


class SingleflightTTLCache:
    """Small in-process cache that computes each live key at most once."""

    def __init__(self, *, max_entries: int = 128) -> None:
        if max_entries < 1:
            raise ValueError("max_entries must be at least 1")
        self._lock = Lock()
        self._max_entries = int(max_entries)
        self._values: OrderedDict[Hashable, tuple[float, Any]] = OrderedDict()
        self._failures: OrderedDict[Hashable, tuple[float, BaseException]] = OrderedDict()
        self._inflight: dict[Hashable, Future[Any]] = {}

    def _purge_expired_locked(self, now: float) -> None:
        for entries in (self._values, self._failures):
            expired = [key for key, (expires_at, _) in entries.items() if expires_at <= now]
            for key in expired:
                entries.pop(key, None)

    def _enforce_capacity_locked(self) -> None:
        while len(self._values) + len(self._failures) > self._max_entries:
            if self._failures:
                self._failures.popitem(last=False)
            else:
                self._values.popitem(last=False)

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
            self._purge_expired_locked(now)
            cached = self._values.get(key)
            if cached:
                self._values.move_to_end(key)
                return deepcopy(cached[1])
            failed = self._failures.get(key)
            if failed:
                self._failures.move_to_end(key)
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
                if failure_ttl_seconds > 0:
                    self._failures[key] = (monotonic() + failure_ttl_seconds, exc)
                    self._failures.move_to_end(key)
                    self._enforce_capacity_locked()
                else:
                    self._failures.pop(key, None)
                self._inflight.pop(key, None)
                future.set_exception(exc)
                # The owner raises directly; mark the Future exception observed.
                future.exception()
            raise

        with self._lock:
            if success_ttl_seconds > 0:
                self._values[key] = (monotonic() + success_ttl_seconds, deepcopy(value))
                self._values.move_to_end(key)
                self._enforce_capacity_locked()
            else:
                self._values.pop(key, None)
            self._failures.pop(key, None)
            self._inflight.pop(key, None)
            future.set_result(deepcopy(value))
        return value

    def clear(self) -> None:
        with self._lock:
            self._values.clear()
            self._failures.clear()
