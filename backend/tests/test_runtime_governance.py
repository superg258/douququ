from __future__ import annotations

import gzip
import json
from pathlib import Path

from scripts.govern_runtime_snapshots import build_index, gzip_sidecars, write_index_atomic


def test_runtime_snapshot_governance_is_dry_run_first_and_retains_originals(
    tmp_path: Path,
) -> None:
    runtime_dir = tmp_path / "rmuc_live"
    raw_dir = runtime_dir / "raw"
    raw_dir.mkdir(parents=True)
    snapshot = raw_dir / "schedule.20260729T010203Z.json"
    snapshot.write_text('{"matches":[1]}', encoding="utf-8")

    planned = gzip_sidecars(runtime_dir, apply=False)
    assert planned == ["raw/schedule.20260729T010203Z.json.gz"]
    assert not snapshot.with_suffix(".json.gz").exists()

    gzip_sidecars(runtime_dir, apply=True)
    compressed = snapshot.with_suffix(".json.gz")
    assert snapshot.exists()
    assert gzip.open(compressed, "rt", encoding="utf-8").read() == '{"matches":[1]}'

    index = build_index(runtime_dir)
    assert index["policy"]["originalsRetained"] is True
    assert index["policy"]["automaticDeletion"] is False
    assert index["snapshots"][0]["gzipPath"].endswith(".json.gz")
    output = runtime_dir / "snapshot_index.json"
    write_index_atomic(output, index)
    assert json.loads(output.read_text(encoding="utf-8"))["snapshotCount"] == 1
