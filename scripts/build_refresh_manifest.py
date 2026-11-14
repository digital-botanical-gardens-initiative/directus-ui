#!/usr/bin/env python3
"""Mark a complete Directus refresh only after all six snapshot exporters succeed."""

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOTS = ("samples", "collectors", "garden_progress", "ms_profile", "processing", "inaturalist")


def parse_timestamp(value, name):
    if not isinstance(value, str):
        raise ValueError(f"Missing {name} generation timestamp")
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as error:
        raise ValueError(f"Invalid {name} generation timestamp") from error
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(f"Unzoned {name} generation timestamp")
    return parsed


def build(root=ROOT):
    data = root / "data"
    snapshots = {name: json.loads((data / f"{name}.json").read_text(encoding="utf-8"))
                 for name in SNAPSHOTS}
    timestamps = {name: parse_timestamp(snapshot.get("generated_at"), name)
                  for name, snapshot in snapshots.items()}
    sample_stamp = snapshots["samples"]["generated_at"]
    for name in SNAPSHOTS[1:]:
        if timestamps[name] < timestamps["samples"]:
            raise ValueError(f"{name} snapshot predates field-sample export; no full refresh")
    for name, field in (("collectors", "sample_snapshot_generated_at"),
                        ("inaturalist", "sample_generated_at")):
        if snapshots[name].get(field) != sample_stamp:
            raise ValueError(f"{name} does not match the field-sample snapshot")
    completed = datetime.now(timezone.utc)
    if any(stamp > completed for stamp in timestamps.values()):
        raise ValueError("A snapshot generation timestamp is in the future")
    manifest = {"completed_at": completed.isoformat(), "sample_generated_at": sample_stamp,
                "snapshots": {name: snapshots[name]["generated_at"] for name in SNAPSHOTS}}
    output = data / "refresh.json"
    temporary = output.with_suffix(".json.tmp")
    try:
        temporary.write_text(json.dumps(manifest, separators=(",", ":")) + "\n", encoding="utf-8")
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    print(f"Completed six Directus snapshot exports at {manifest['completed_at']}")
    return manifest


if __name__ == "__main__":
    build()
