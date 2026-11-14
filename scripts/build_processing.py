#!/usr/bin/env python3
"""Export recorded processing stages linked by Directus FKs to published field samples."""

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
import os
from pathlib import Path

from build_garden_progress import unique_rows
from build_ms_profile import published_samples
from build_snapshot import DEFAULT_BASE, credentials, fetch_all

OUT = Path(__file__).resolve().parents[1] / "data" / "processing.json"
SAMPLES = OUT.with_name("samples.json")
FIELDS = {
    "Field_Data": "id,sample_id,taxon_ref",
    "Containers": "id,container_id,parent_container",
    "Dried_Samples_Data": "id,status,field_data,sample_container",
    "Extraction_Data": "id,status,sample_container,parent_sample_container",
    "Aliquoting_Data": "id,status,sample_container,parent_sample_container",
    "MS_Data": "id,status,parent_sample_container",
}
COLUMNS = ["kind", "id", "field_id", "container_id", "container_label",
           "parent_container_id", "status"]
STAGES = (("dried", "Dried_Samples_Data"), ("extract", "Extraction_Data"),
          ("aliquot", "Aliquoting_Data"), ("ms", "MS_Data"))


def processing_snapshot(records, published, base, generated_at):
    """Include only explicit, unambiguous lineage ending at a published field ID."""
    rows = {name: unique_rows(records[name], name) for name in FIELDS}
    fields, containers = rows["Field_Data"], rows["Containers"]
    for field_id, identity in published.items():
        field = fields.get(field_id)
        if field is None:
            raise ValueError(f"Published Field_Data {field_id} is missing from Directus")
        sample_id = field.get("sample_id")
        actual = (sample_id.strip() if isinstance(sample_id, str) else sample_id,
                  field.get("taxon_ref"))
        if actual != identity:
            raise ValueError(f"Field_Data {field_id} sample_id or taxon_ref differs from published samples")

    # Container labels can identify a field root only if unique; duplicate labels
    # cannot justify a parent pointer, even if a dried record has an explicit FK.
    by_label = {}
    for container in containers.values():
        label = container.get("container_id")
        if not isinstance(label, str):
            raise ValueError(f"Containers {container['id']} has no container_id label")
        by_label.setdefault(label, []).append(container["id"])
        parent = container.get("parent_container")
        if parent is not None and parent not in containers:
            raise ValueError(f"Containers {container['id']} references a missing parent container")

    owners = {}

    def assign(container_id, field_id, origin):
        existing = owners.get(container_id)
        if existing is not None and existing != field_id:
            raise ValueError(f"Conflicting {origin} ancestry for container {container_id}")
        if existing is None:
            owners[container_id] = field_id
            return True
        return False

    roots = {}
    for field in fields.values():
        matches = by_label.get(field.get("sample_id"), [])
        if len(matches) == 1:
            root = matches[0]
            assign(root, field["id"], "Field_Data")
            roots[field["id"]] = root

    # All stage FKs must point to existing containers, even if the stage is not
    # eventually published. Dried_Samples_Data.field_data is an explicit root.
    for kind, collection in STAGES:
        for stage in rows[collection].values():
            keys = (("parent_sample_container",) if kind == "ms" else
                    ("sample_container",) if kind == "dried" else
                    ("sample_container", "parent_sample_container"))
            for key in keys:
                if stage.get(key) not in containers:
                    raise ValueError(f"{collection} {stage['id']} references a missing {key} container")
            if kind == "dried":
                field_id = stage.get("field_data")
                if field_id is not None and field_id not in fields:
                    raise ValueError(f"{collection} {stage['id']} references a missing Field_Data")
                if field_id is not None:
                    assign(stage["sample_container"], field_id, collection)

    # Edges originate ONLY from the stage's parent_sample_container FK, never
    # from a container label, status, or the incidental Containers parent field.
    edges = [(stage["parent_sample_container"], stage["sample_container"], collection)
             for kind, collection in STAGES if kind in ("extract", "aliquot")
             for stage in rows[collection].values()]
    while True:
        changed = False
        for parent, child, collection in edges:
            owner = owners.get(parent)
            if owner is not None:
                changed |= assign(child, owner, collection)
        if not changed:
            break

    # Check independently recorded container parents where both ends have a
    # known field; never use them to manufacture a processing path.
    for container in containers.values():
        parent = container.get("parent_container")
        child_owner, parent_owner = owners.get(container["id"]), owners.get(parent)
        if child_owner is not None and parent_owner is not None and child_owner != parent_owner:
            raise ValueError(f"Conflicting Containers ancestry for container {container['id']}")

    exported = []
    excluded = Counter()
    for kind, collection in STAGES:
        for stage in sorted(rows[collection].values(), key=lambda row: row["id"]):
            if kind == "dried":
                field_id = stage.get("field_data")
                container_id = stage["sample_container"]
                parent = roots.get(field_id)
                if parent == container_id:
                    parent = None
            else:
                parent = stage["parent_sample_container"]
                field_id = owners.get(parent)
                container_id = None if kind == "ms" else stage["sample_container"]
                if field_id is not None and container_id is not None:
                    assign(container_id, field_id, collection)
            if field_id is None:
                excluded[f"excluded_unlinked_{kind}"] += 1
                continue
            if field_id not in published:
                excluded[f"excluded_outside_snapshot_{kind}"] += 1
                continue
            if parent is not None and owners.get(parent) != field_id:
                raise ValueError(f"Conflicting {collection} {stage['id']} parent ancestry")
            status = stage.get("status")
            if status is not None and not isinstance(status, str):
                raise ValueError(f"{collection} {stage['id']} has a non-string status")
            exported.append([kind, stage["id"], field_id, container_id,
                             containers[container_id]["container_id"] if container_id is not None else None,
                             parent, status])
    totals = {f"total_{kind}_records": len(rows[collection]) for kind, collection in STAGES}
    for kind, collection in STAGES:
        if (sum(row[0] == kind for row in exported) + excluded[f"excluded_unlinked_{kind}"]
                + excluded[f"excluded_outside_snapshot_{kind}"] != len(rows[collection])):
            raise ValueError(f"{collection} export counts do not reconcile")
    return {"source": base.rstrip("/") + "/items/", "generated_at": generated_at,
            "columns": COLUMNS, "records": exported, **totals,
            **{key: excluded[key] for kind, _ in STAGES for key in
               (f"excluded_unlinked_{kind}", f"excluded_outside_snapshot_{kind}")}}


def build(env_file=None, output=OUT, samples=SAMPLES):
    published = published_samples(samples)
    if env_file is not None or os.environ.get("DIRECTUS_TOKEN") or os.environ.get("DIRECTUS_USERNAME"):
        base, token = credentials(env_file)
    else:
        base, token = DEFAULT_BASE, ""
    records = {name: fetch_all(name, fields, base, token) for name, fields in FIELDS.items()}
    snapshot = processing_snapshot(records, published, base, datetime.now(timezone.utc).isoformat())
    output = Path(output)
    temporary = output.with_suffix(output.suffix + ".tmp")
    temporary.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n",
                         encoding="utf-8")
    temporary.replace(output)
    print(f"Exported {len(snapshot['records'])} linked processing records to {output}; "
          + ", ".join(f"{key}={value}" for key, value in snapshot.items()
                      if key.startswith("excluded_")))
    return snapshot


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, help="Optional local Directus credentials file")
    parser.add_argument("--output", type=Path, default=OUT)
    parser.add_argument("--samples", type=Path, default=SAMPLES, help="Published samples snapshot")
    args = parser.parse_args()
    build(args.env_file, args.output, args.samples)
