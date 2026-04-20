from __future__ import annotations

import sys
import types
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

import build_rmuc_elo as legacy_elo  # noqa: E402

if "build_rmuc_ts2_backend" not in sys.modules:
    ts2_stub = types.ModuleType("build_rmuc_ts2_backend")
    ts2_stub.DERIVED_DIR = ROOT / "data" / "derived" / "2026_rmuc_ts2"
    ts2_stub.ROOT = ROOT
    ts2_stub.make_team_key = legacy_elo.make_team_key
    sys.modules["build_rmuc_ts2_backend"] = ts2_stub

from backend.app.main import app


client = TestClient(app)


def test_simulation_exposes_nonzero_head_to_head_adjustments() -> None:
    response = client.get("/api/regions/east_region/simulation", params={"seed": 20260414})
    assert response.status_code == 200
    payload = response.json()

    assert payload["matches"]
    assert any(abs(float(match["deltaH2H"])) > 0.0 for match in payload["matches"])
