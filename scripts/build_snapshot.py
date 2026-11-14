#!/usr/bin/env python3
"""Export public field records and their resolved CoL taxonomy for the static site."""

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

DEFAULT_BASE = "https://emi-collection.unifr.ch/directus"
OUT = Path(__file__).resolve().parents[1] / "data" / "samples.json"
FIELD_FIELDS = "id,sample_id,qfield_project,taxon_name_unified,taxon_name,sample_name,geometry,date,taxon_ref,taxon_col_id,taxon_resolution_status,observation_subject"
TAXON_FIELDS = "id,col_id,scientific_name,authorship,rank,parent_ref,backbone_version"
PAGE_SIZE = 500


def credentials(env_file=None):
    """Prefer a read-only token; local username/password login is an explicit alternative."""
    values = {}
    if env_file is not None:
        for line in Path(env_file).read_text(encoding="utf-8").splitlines():
            if "=" not in line or line.lstrip().startswith("#"):
                continue
            key, value = line.split("=", 1)
            value = value.strip()
            if len(value) >= 2 and value[0] in ("'", '"') and value[-1] == value[0]:
                value = value[1:-1]
            values[key.strip()] = value
    values.update(os.environ)
    base = values.get("DIRECTUS_INSTANCE", DEFAULT_BASE).rstrip("/")
    parts = urlsplit(base)
    if parts.scheme != "https" or not parts.hostname or parts.username or parts.password or parts.query or parts.fragment:
        raise ValueError("DIRECTUS_INSTANCE must be a credential-free HTTPS URL")
    token = values.get("DIRECTUS_TOKEN")
    if token:
        return base, token
    username, password = values.get("DIRECTUS_USERNAME"), values.get("DIRECTUS_PASSWORD")
    if not username or not password:
        raise ValueError("Taxa is not publicly readable: set DIRECTUS_TOKEN with Field_Data and Taxa read permissions, or pass --env-file with Directus login credentials")
    request = Request(base + "/auth/login", data=json.dumps({"email": username, "password": password}).encode(),
                      headers={"Content-Type": "application/json"}, method="POST")
    with urlopen(request, timeout=30) as response:
        return base, json.load(response)["data"]["access_token"]


def get_data(collection, params, base, token):
    request = Request(base + "/items/" + collection + "?" + urlencode(params),
                      headers={"Authorization": "Bearer " + token})
    with urlopen(request, timeout=60) as response:
        payload = json.load(response)
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        raise ValueError(f"Directus {collection} did not return a data array")
    return payload["data"]


def fetch_all(collection, fields, base, token):
    expected = int(get_data(collection, {"aggregate[count]": "id"}, base, token)[0]["count"]["id"])
    rows = []
    seen = set()
    while len(rows) < expected:
        page = get_data(collection, {"fields": fields, "limit": PAGE_SIZE,
                                     "offset": len(rows), "sort": "id"}, base, token)
        if not page:
            raise ValueError(f"Incomplete {collection} export: {len(rows)}/{expected} rows")
        for row in page:
            key = row.get("id") if isinstance(row, dict) else None
            if isinstance(key, bool) or not isinstance(key, int) or key in seen:
                raise ValueError(f"Invalid or duplicate {collection} id {key!r}")
            seen.add(key)
        rows.extend(page)
    if len(rows) != expected or int(get_data(collection, {"aggregate[count]": "id"}, base, token)[0]["count"]["id"]) != expected:
        raise ValueError(f"{collection} count changed during export; retry the build")
    return rows


def public_row(row):
    """Use the approved field name as recorded; never invent a resolved name."""
    sample_id = row.get("sample_id")
    if not isinstance(sample_id, str) or not sample_id.strip():
        return None
    point = row.get("geometry")
    coordinates = point.get("coordinates") if isinstance(point, dict) and point.get("type") == "Point" else None
    if (not isinstance(coordinates, list) or len(coordinates) != 2
            or any(isinstance(n, bool) or not isinstance(n, (int, float)) for n in coordinates)
            or not (-180 <= coordinates[0] <= 180 and -90 <= coordinates[1] <= 90)):
        coordinates = [None, None]
    recorded = next((value.strip() for key in ("taxon_name_unified", "taxon_name", "sample_name")
                     if isinstance(value := row.get(key), str) and value.strip()), None)
    taxon_id = row.get("taxon_ref")
    if taxon_id is not None and (isinstance(taxon_id, bool) or not isinstance(taxon_id, int)):
        raise ValueError(f"Invalid taxon_ref on Field_Data {row['id']}")
    project = row.get("qfield_project")
    date = row.get("date")
    status = row.get("taxon_resolution_status")
    subject = row.get("observation_subject")
    if subject is not None and not isinstance(subject, str):
        raise ValueError(f"Invalid observation_subject on Field_Data {row['id']}")
    subject = subject.strip() if subject is not None else None
    return [row["id"], sample_id.strip(), project.strip() if isinstance(project, str) else None,
            recorded, *coordinates, date if isinstance(date, str) else None, taxon_id,
            status if isinstance(status, str) else None, subject or None]


def public_taxon(row):
    parent = row.get("parent_ref")
    if parent is not None and (isinstance(parent, bool) or not isinstance(parent, int)):
        raise ValueError(f"Invalid Taxa parent_ref on {row['id']}")
    if (not isinstance(row.get("scientific_name"), str) or not row["scientific_name"].strip()
            or not isinstance(row.get("rank"), str) or not row["rank"].strip()
            or not isinstance(row.get("col_id"), str) or not row["col_id"].strip()):
        raise ValueError(f"Taxa {row['id']} has no CoL ID, scientific name or rank")
    return [row["id"], row["col_id"].strip(), row["scientific_name"].strip(),
            row.get("authorship"), row["rank"].strip().lower(), parent, row.get("backbone_version")]


def validate_links(field_rows, taxa_rows):
    """Reject broken ancestry and stale relations rather than miscounting families."""
    by_id = {row[0]: row for row in taxa_rows}
    for taxon in taxa_rows:
        path = set()
        current = taxon
        while current is not None:
            if current[0] in path:
                raise ValueError(f"Taxa ancestry cycle at {current[0]}")
            path.add(current[0])
            parent_id = current[5]
            if parent_id is not None and parent_id not in by_id:
                raise ValueError(f"Missing Taxa parent {parent_id}")
            current = by_id.get(parent_id)
    for row in field_rows:
        taxon_id = row.get("taxon_ref")
        if taxon_id is None:
            continue
        taxon = by_id.get(taxon_id)
        if taxon is None:
            raise ValueError(f"Field_Data {row['id']} refers to missing Taxa {taxon_id}")
        col_id = row.get("taxon_col_id")
        if col_id and col_id != taxon[1]:
            raise ValueError(f"Field_Data {row['id']} has a mismatched CoL id")


def build(env_file=None):
    base, token = credentials(env_file)
    field_rows = fetch_all("Field_Data", FIELD_FIELDS, base, token)
    taxa_source = fetch_all("Taxa", TAXON_FIELDS, base, token)
    taxa_rows = [public_taxon(row) for row in taxa_source]
    validate_links(field_rows, taxa_rows)
    rows = [item for row in field_rows if (item := public_row(row)) is not None]
    result = {"source": base, "generated_at": datetime.now(timezone.utc).isoformat(),
              "total_rows": len(field_rows),
              "columns": ["directus_id", "sample_id", "project", "recorded_taxon", "longitude", "latitude", "date", "taxon_id", "resolution_status", "observation_subject"],
              "taxon_columns": ["id", "col_id", "scientific_name", "authorship", "rank", "parent_id", "backbone_version"],
              "taxa": taxa_rows, "rows": rows}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUT.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    temporary.replace(OUT)
    print(f"Exported {len(rows)} samples and {len(taxa_rows)} Taxa to {OUT}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, help="Local Directus login file (never exported)")
    build(parser.parse_args().env_file)
