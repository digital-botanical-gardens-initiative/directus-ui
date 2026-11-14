#!/usr/bin/env python3
"""Export linked collector identities for the published sample snapshot."""

import argparse
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

if __package__:
    from . import build_snapshot
else:
    import build_snapshot

SAMPLES = Path(__file__).resolve().parents[1] / "data" / "samples.json"
OUT = SAMPLES.with_name("collectors.json")
FIELD_FIELDS = "id,sample_id,collector_ref,collector_fullname"
PEOPLE_FIELDS = "id,full_name"


def positive_id(value):
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def published_samples(snapshot):
    if not isinstance(snapshot, dict) or not isinstance(snapshot.get("rows"), list):
        raise ValueError("Invalid published samples snapshot")
    ids = {}
    for row in snapshot["rows"]:
        if (not isinstance(row, list) or len(row) < 2 or not positive_id(row[0])
                or not isinstance(row[1], str) or not row[1].strip()):
            raise ValueError("Invalid published Field_Data id or sample_id")
        if row[0] in ids:
            raise ValueError(f"Duplicate published Field_Data id {row[0]}")
        ids[row[0]] = row[1]
    if not isinstance(snapshot.get("generated_at"), str) or not snapshot["generated_at"]:
        raise ValueError("Published samples snapshot is missing generated_at")
    return ids


def collect(snapshot, field_rows, people_rows, base):
    """Use only stable Directus keys; recorded names never establish identities."""
    published = published_samples(snapshot)
    if snapshot.get("source") != base:
        raise ValueError("Published samples snapshot belongs to a different Directus source")
    people = {}
    for person in people_rows:
        if not isinstance(person, dict) or not positive_id(person.get("id")) or person["id"] in people:
            raise ValueError("Invalid or duplicate People id")
        people[person["id"]] = person.get("full_name")

    linked = defaultdict(list)
    seen = set()
    unlinked_named = 0
    for field in field_rows:
        if not isinstance(field, dict) or not positive_id(field.get("id")) or field["id"] in seen:
            raise ValueError("Invalid or duplicate Field_Data id")
        field_id = field["id"]
        seen.add(field_id)
        if field_id not in published:
            continue
        sample_id = field.get("sample_id")
        # build_snapshot.public_row strips the source value before publication.
        if not isinstance(sample_id, str) or sample_id.strip() != published[field_id]:
            raise ValueError(f"Published Field_Data {field_id} sample_id mismatch")
        person_id = field.get("collector_ref")
        if person_id is None:
            if isinstance(field.get("collector_fullname"), str) and field["collector_fullname"].strip():
                unlinked_named += 1
            continue
        if not positive_id(person_id):
            raise ValueError(f"Invalid collector_ref on Field_Data {field_id}")
        if person_id not in people:
            raise ValueError(f"Field_Data {field_id} refers to missing People {person_id}")
        name = people[person_id]
        if not isinstance(name, str) or not name.strip():
            raise ValueError(f"People {person_id} has no full_name")
        linked[person_id].append(field_id)
    missing = published.keys() - seen
    if missing:
        raise ValueError(f"Published Field_Data {min(missing)} is missing from Directus")

    collectors = [{"id": person_id, "name": people[person_id].strip(), "field_ids": sorted(field_ids)}
                  for person_id, field_ids in linked.items()]
    collectors.sort(key=lambda person: (-len(person["field_ids"]), person["name"], person["id"]))
    return {"source": base, "generated_at": datetime.now(timezone.utc).isoformat(),
            "sample_snapshot_generated_at": snapshot["generated_at"],
            "total_field_rows": len(field_rows), "unlinked_named_samples": unlinked_named,
            "collectors": collectors}


def build(env_file=None):
    snapshot = json.loads(SAMPLES.read_text(encoding="utf-8"))
    published_samples(snapshot)
    base, token = build_snapshot.credentials(env_file)
    fields = build_snapshot.fetch_all("Field_Data", FIELD_FIELDS, base, token)
    people = build_snapshot.fetch_all("People", PEOPLE_FIELDS, base, token)
    result = collect(snapshot, fields, people, base)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUT.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    temporary.replace(OUT)
    print(f"Exported {len(result['collectors'])} linked collectors to {OUT}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, help="Local Directus login file (never exported)")
    build(parser.parse_args().env_file)
