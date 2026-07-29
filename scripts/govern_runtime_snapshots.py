from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RUNTIME_DIR = ROOT / "data" / "runtime" / "rmuc_live"
TIMESTAMPED_SNAPSHOT_RE = re.compile(r"\.\d{8}T\d{6}Z\.json$")


def snapshot_files(runtime_dir: Path) -> list[Path]:
    return sorted(
        candidate
        for raw_dir in (runtime_dir / "raw", runtime_dir / "finals" / "raw")
        if raw_dir.exists()
        for candidate in raw_dir.rglob("*.json")
        if TIMESTAMPED_SNAPSHOT_RE.search(candidate.name)
    )


def build_index(runtime_dir: Path) -> dict[str, Any]:
    entries = []
    for snapshot in snapshot_files(runtime_dir):
        content = snapshot.read_bytes()
        stat = snapshot.stat()
        compressed = snapshot.with_suffix(snapshot.suffix + ".gz")
        entries.append(
            {
                "path": str(snapshot.relative_to(runtime_dir)),
                "sizeBytes": len(content),
                "sha256": hashlib.sha256(content).hexdigest(),
                "modifiedAt": datetime.fromtimestamp(stat.st_mtime, tz=UTC).isoformat(),
                "gzipPath": (
                    str(compressed.relative_to(runtime_dir)) if compressed.exists() else None
                ),
            }
        )
    return {
        "schemaVersion": "rmuc-runtime-snapshot-index-v1",
        "policy": {
            "originalsRetained": True,
            "automaticDeletion": False,
            "compressionCreatesSidecar": True,
        },
        "snapshotCount": len(entries),
        "snapshots": entries,
    }


def gzip_sidecars(runtime_dir: Path, *, apply: bool) -> list[str]:
    planned = []
    for snapshot in snapshot_files(runtime_dir):
        compressed = snapshot.with_suffix(snapshot.suffix + ".gz")
        if compressed.exists():
            continue
        planned.append(str(compressed.relative_to(runtime_dir)))
        if apply:
            temporary = compressed.with_suffix(compressed.suffix + ".tmp")
            with snapshot.open("rb") as source, gzip.GzipFile(
                filename=str(temporary),
                mode="wb",
                mtime=0,
            ) as target:
                target.write(source.read())
            temporary.replace(compressed)
    return planned


def write_index_atomic(output: Path, payload: dict[str, Any]) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    temporary.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(output)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Index runtime snapshots and optionally create gzip sidecars without deletion."
    )
    parser.add_argument("--runtime-dir", type=Path, default=DEFAULT_RUNTIME_DIR)
    parser.add_argument("--index-output", type=Path)
    parser.add_argument("--gzip", action="store_true", help="Plan gzip sidecars.")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write the index and gzip sidecars. Originals are always retained.",
    )
    args = parser.parse_args()
    planned_gzip = gzip_sidecars(args.runtime_dir, apply=args.apply) if args.gzip else []
    index = build_index(args.runtime_dir)
    output = args.index_output or args.runtime_dir / "snapshot_index.json"
    if args.apply:
        write_index_atomic(output, index)
    print(
        json.dumps(
            {
                "mode": "apply" if args.apply else "dry-run",
                "indexOutput": str(output),
                "snapshotCount": index["snapshotCount"],
                "gzipSidecars": planned_gzip,
                "originalsRetained": True,
                "automaticDeletion": False,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
