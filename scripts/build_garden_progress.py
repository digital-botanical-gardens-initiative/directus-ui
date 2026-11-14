#!/usr/bin/env python3
"""Export garden sample stages from Directus collection relations only."""

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

from build_snapshot import DEFAULT_BASE, credentials, fetch_all

OUT = Path(__file__).resolve().parents[1] / "data" / "garden_progress.json"
CATALOG = OUT.with_name("gardens.json")


def load_gardens(path=CATALOG):
    """Validate the shared catalog before using any project alias for counts."""
    catalog = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(catalog, dict) or set(catalog) != {"gardens"}:
        raise ValueError("Garden catalog must contain gardens")
    gardens = catalog["gardens"]
    if not isinstance(gardens, list) or len(gardens) != 5:
        raise ValueError("Garden catalog must contain exactly five gardens")
    ids, names, urls, aliases = set(), set(), set(), set()
    for garden in gardens:
        if not isinstance(garden, dict) or set(garden) != {"id", "name", "aliases", "url"}:
            raise ValueError("Garden catalog entry requires id, name, aliases, url")
        garden_id, name, projects, url = (garden[key] for key in ("id", "name", "aliases", "url"))
        if (not isinstance(garden_id, str) or not garden_id or
                any(character not in "abcdefghijklmnopqrstuvwxyz0123456789-" for character in garden_id) or
                not isinstance(name, str) or not name.strip() or name != name.strip() or
                not isinstance(url, str)):
            raise ValueError("Invalid garden catalog id, name, or url")
        address = urlsplit(url)
        if (address.scheme != "https" or address.netloc != "www.dbgi.org" or
                address.path != f"/gardens/{garden_id}/" or address.query or address.fragment):
            raise ValueError(f"Invalid DBGI garden URL for {garden_id}")
        if (garden_id in ids or name in names or url in urls):
            raise ValueError("Duplicate garden catalog id, name, or url")
        ids.add(garden_id)
        names.add(name)
        urls.add(url)
        if not isinstance(projects, list) or not projects:
            raise ValueError(f"Missing project aliases for {garden_id}")
        for alias in projects:
            if not isinstance(alias, str) or not alias.strip() or alias != alias.strip():
                raise ValueError(f"Invalid project alias for {garden_id}")
            if alias in aliases:
                raise ValueError(f"Duplicate project alias {alias}")
            aliases.add(alias)
    return gardens

FIELDS = {
    "Field_Data": "id,sample_id,qfield_project",
    "Containers": "id,container_id,parent_container",
    "Dried_Samples_Data": "id,status,field_data,sample_container",
    "Extraction_Data": "id,status,sample_container,parent_sample_container",
    "Aliquoting_Data": "id,status,sample_container,parent_sample_container",
    "MS_Data": "id,status,parent_sample_container",
}


def unique_rows(rows, collection):
    by_id = {}
    for row in rows:
        key = row.get("id")
        if isinstance(key, bool) or not isinstance(key, int) or key in by_id:
            raise ValueError(f"Invalid or duplicate {collection} id")
        by_id[key] = row
    return by_id


def link(container_fields, container_id, field_id, origin):
    """A container can represent the same field sample at several processing steps."""
    if container_id is None:
        raise ValueError(f"{origin} has no sample container")
    existing = container_fields.get(container_id)
    if existing is not None and existing != field_id:
        raise ValueError(f"Conflicting {origin} lineage for container {container_id}")
    container_fields[container_id] = field_id


def processing_lineage(rows):
    """Trace only declared container relations, retaining each processing stage."""
    fields = rows["Field_Data"]
    containers = rows["Containers"]
    by_name = {}
    for container in containers.values():
        name = container.get("container_id")
        if name in by_name:
            # Ambiguous names cannot prove a Field_Data -> container identity.
            by_name[name] = None
        else:
            by_name[name] = container["id"]
    source = {}
    for field in fields.values():
        container_id = by_name.get(field.get("sample_id"))
        if container_id is not None:
            link(source, container_id, field["id"], "Field_Data")
    lineage = source.copy()
    unlinked = Counter()
    for dried in rows["Dried_Samples_Data"].values():
        field_id = dried.get("field_data")
        container_id = dried.get("sample_container")
        if container_id not in containers:
            raise ValueError("Dried_Samples_Data references a missing container")
        if field_id is None or field_id not in fields:
            unlinked["Dried_Samples_Data"] += 1
            continue
        link(lineage, container_id, field_id, "Dried_Samples_Data")
        link(source, container_id, field_id, "Dried_Samples_Data")
    extraction_fields = {}
    extra_containers = {}
    for extraction in rows["Extraction_Data"].values():
        parent = extraction.get("parent_sample_container")
        container_id = extraction.get("sample_container")
        if parent not in containers or container_id not in containers:
            raise ValueError("Extraction_Data references a missing container")
        field_id = source.get(parent)
        extraction_fields[extraction["id"]] = field_id
        if field_id is None:
            unlinked["Extraction_Data"] += 1
            continue
        link(lineage, container_id, field_id, "Extraction_Data")
        link(extra_containers, container_id, field_id, "Extraction_Data")
    aliquot_containers = {}
    for aliquot in rows["Aliquoting_Data"].values():
        parent = aliquot.get("parent_sample_container")
        container_id = aliquot.get("sample_container")
        if parent not in containers or container_id not in containers:
            raise ValueError("Aliquoting_Data references a missing container")
        field_id = extra_containers.get(parent)
        if field_id is None:
            # Some aliquots have a field/dried container as their direct parent.
            field_id = source.get(parent)
        if field_id is None:
            unlinked["Aliquoting_Data"] += 1
            continue
        link(lineage, container_id, field_id, "Aliquoting_Data")
        link(aliquot_containers, container_id, field_id, "Aliquoting_Data")
    ms_fields = {}
    for ms in rows["MS_Data"].values():
        parent = ms.get("parent_sample_container")
        if parent not in containers:
            raise ValueError("MS_Data references a missing container")
        field_id = aliquot_containers.get(parent)
        if field_id is None:
            field_id = extra_containers.get(parent)
        if field_id is None:
            field_id = source.get(parent)
        ms_fields[ms["id"]] = field_id
        if field_id is None:
            unlinked["MS_Data"] += 1
    return extraction_fields, ms_fields, unlinked


def progress_snapshot(records, base, generated_at, gardens=None):
    """Follow explicit FK paths; never infer identity from a filename or prefix."""
    gardens = load_gardens() if gardens is None else gardens
    rows = {name: unique_rows(records[name], name) for name in FIELDS}
    fields = rows["Field_Data"]
    projects = {project for garden in gardens for project in garden["aliases"]}
    garden_fields = {key: field for key, field in fields.items()
                     if field.get("qfield_project") in projects}
    if len({field.get("sample_id") for field in garden_fields.values()}) != len(garden_fields):
        raise ValueError("Duplicate garden Field_Data sample_id")
    extraction_fields, ms_lineage, unlinked = processing_lineage(rows)
    extracted = set()
    extra_statuses = Counter()
    for extraction in rows["Extraction_Data"].values():
        field_id = extraction_fields[extraction["id"]]
        if field_id in garden_fields:
            extracted.add(field_id)
            extra_statuses[str(extraction.get("status"))] += 1
    ms_fields = set()
    ms_statuses = Counter()
    ms_without_extraction = set()
    for ms in rows["MS_Data"].values():
        field_id = ms_lineage[ms["id"]]
        if field_id in garden_fields:
            ms_fields.add(field_id)
            ms_statuses[str(ms.get("status"))] += 1
            if field_id not in extracted:
                ms_without_extraction.add(field_id)
    groups = []
    for garden in gardens:
        aliases = garden["aliases"]
        members = [field for field in garden_fields.values() if field["qfield_project"] in aliases]
        if not members:
            raise ValueError(f"No Field_Data rows for {garden['name']}")
        ids = {field["id"] for field in members}
        groups.append({"id": garden["id"], "garden": garden["name"],
                       "projects": list(aliases), "samples": len(members),
                       "collected_only": len(ids - extracted - ms_fields),
                       "extraction_record_present": len((ids & extracted) - ms_fields),
                       "ms_record_present": len(ids & ms_fields)})
    return {
        "source": base.rstrip("/") + "/items/",
        "generated_at": generated_at,
        "method": "Each Field_Data sample grouped by qfield_project. Field_Data.sample_id = Containers.container_id or Dried_Samples_Data.field_data -> sample_container; Extraction_Data.parent_sample_container -> sample_container; Aliquoting_Data.parent_sample_container -> sample_container; MS_Data.parent_sample_container -> container. An MS record takes precedence over an extraction record regardless of status. Status counts describe records, not verified success or instrument files.",
        "total_samples": len(garden_fields),
        "gardens": groups,
        "record_statuses": {"Extraction_Data": dict(sorted(extra_statuses.items())),
                            "MS_Data": dict(sorted(ms_statuses.items()))},
        "ms_without_extraction_samples": len(ms_without_extraction),
        "unlinked_processing_records": {name: unlinked[name] for name in
                                        ("Dried_Samples_Data", "Extraction_Data", "Aliquoting_Data", "MS_Data")},
    }


def build(env_file=None, output=OUT, catalog=CATALOG):
    gardens = load_gardens(catalog)
    if env_file is not None or os.environ.get("DIRECTUS_TOKEN") or os.environ.get("DIRECTUS_USERNAME"):
        base, token = credentials(env_file)
    else:
        base, token = DEFAULT_BASE, ""  # These collection fields are publicly readable.
    records = {name: fetch_all(name, fields, base, token) for name, fields in FIELDS.items()}
    snapshot = progress_snapshot(records, base, datetime.now(timezone.utc).isoformat(), gardens)
    output = Path(output)
    temporary = output.with_suffix(output.suffix + ".tmp")
    temporary.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    temporary.replace(output)
    print(f"Exported {snapshot['total_samples']} botanical-garden samples to {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, help="Optional local Directus credentials file")
    parser.add_argument("--output", type=Path, default=OUT)
    args = parser.parse_args()
    build(args.env_file, args.output)
