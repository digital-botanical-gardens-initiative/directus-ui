#!/usr/bin/env python3
"""Export recorded Directus MS files linked to the published field-sample snapshot."""

import argparse
from datetime import datetime, timezone
import json
import os
import re
from pathlib import Path

from build_garden_progress import processing_lineage, unique_rows
from build_snapshot import DEFAULT_BASE, credentials, fetch_all

OUT = Path(__file__).resolve().parents[1] / "data" / "ms_profile.json"
SAMPLES = OUT.with_name("samples.json")
FIELDS = {
    "Field_Data": "id,sample_id,taxon_ref",
    "Containers": "id,container_id",
    "Dried_Samples_Data": "id,field_data,sample_container",
    "Extraction_Data": "id,sample_container,parent_sample_container",
    "Aliquoting_Data": "id,sample_container,parent_sample_container",
    "MS_Data": "id,status,uuid_ms_file,instrument_used,parent_sample_container,filename",
    "Instruments": "id,instrument_id,instrument_model.id,instrument_model.instrument_model",
}
SAMPLE_COLUMNS = ["directus_id", "sample_id", "project", "recorded_taxon", "longitude",
                  "latitude", "date", "taxon_id", "resolution_status"]


def published_samples(path):
    """Keep only immutable published IDs with their recorded identity and taxon."""
    snapshot = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(snapshot, dict) or snapshot.get("columns") != SAMPLE_COLUMNS or not isinstance(snapshot.get("rows"), list):
        raise ValueError("Invalid published samples snapshot")
    samples = {}
    for row in snapshot["rows"]:
        if not isinstance(row, list) or len(row) != len(SAMPLE_COLUMNS):
            raise ValueError("Invalid published sample row")
        key, sample_id, taxon_ref = row[0], row[1], row[7]
        if (isinstance(key, bool) or not isinstance(key, int) or key in samples
                or not isinstance(sample_id, str) or not sample_id.strip()
                or (taxon_ref is not None and (isinstance(taxon_ref, bool) or not isinstance(taxon_ref, int)))):
            raise ValueError("Invalid or duplicate published sample identity")
        samples[key] = (sample_id, taxon_ref)
    return samples


def safe_filename(value):
    """Keep only a single inert basename for constructing a GNPS USI."""
    return (value if isinstance(value, str) and value == value.strip()
            and re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9._ -]*", value) else None)


def profile_snapshot(records, published, base, generated_at):
    """Count only existing-file MS records traced to unchanged published field IDs."""
    rows = {name: unique_rows(records[name], name) for name in FIELDS}
    fields = rows["Field_Data"]
    for field_id, field in fields.items():
        sample_id = field.get("sample_id")
        identity = (sample_id.strip() if isinstance(sample_id, str) else sample_id, field.get("taxon_ref"))
        if field_id in published and identity != published[field_id]:
            raise ValueError(f"Field_Data {field_id} sample_id or taxon_ref differs from published samples")
    _, ms_lineage, _ = processing_lineage(rows)
    instruments = []
    for instrument in rows["Instruments"].values():
        model = instrument.get("instrument_model")
        code = instrument.get("instrument_id")
        if (not isinstance(code, str) or not code.strip() or not isinstance(model, dict)
                or isinstance(model.get("id"), bool) or not isinstance(model.get("id"), int)
                or not isinstance(model.get("instrument_model"), str)
                or not model["instrument_model"].strip()):
            raise ValueError(f"Instruments {instrument['id']} has no valid code or model relation")
        instruments.append([instrument["id"], code, model["instrument_model"]])
    profiles = []
    unavailable_filenames = 0
    excluded = {"excluded_unlinked_ms": 0, "excluded_outside_snapshot_ms": 0,
                "excluded_without_file_ms": 0, "excluded_other_status_ms": 0}
    for ms in rows["MS_Data"].values():
        instrument_id = ms.get("instrument_used")
        if (isinstance(instrument_id, bool) or not isinstance(instrument_id, int)
                or instrument_id not in rows["Instruments"]):
            raise ValueError(f"MS_Data {ms['id']} references a missing instrument")
        status = ms.get("status")
        if status not in ("OK", "published"):
            excluded["excluded_other_status_ms"] += 1
            continue
        file_uuid = ms.get("uuid_ms_file")
        if not isinstance(file_uuid, str) or not file_uuid.strip():
            excluded["excluded_without_file_ms"] += 1
            continue
        field_id = ms_lineage[ms["id"]]
        if field_id is None:
            excluded["excluded_unlinked_ms"] += 1
        elif field_id not in published:
            excluded["excluded_outside_snapshot_ms"] += 1
        else:
            filename = safe_filename(ms.get("filename"))
            if filename is None:
                unavailable_filenames += 1
            profiles.append([ms["id"], field_id, instrument_id, status, filename])
    if len(profiles) + sum(excluded.values()) != len(rows["MS_Data"]):
        raise ValueError("MS_Data export counts do not reconcile")
    return {
        "source": base.rstrip("/") + "/items/", "generated_at": generated_at,
        "method": "Directus FK lineage: Field_Data.sample_id = Containers.container_id or Dried_Samples_Data.field_data -> sample_container; Extraction_Data.parent_sample_container -> sample_container; Aliquoting_Data.parent_sample_container -> sample_container; MS_Data.parent_sample_container -> container. Field_Data IDs, sample_id and taxon_ref must agree with published samples.json. Only status OK/published and nonempty uuid_ms_file indicates a recorded MS file, not QC success; instrument_used links to Instruments. A safe MS_Data filename basename is published as recorded; unsafe or missing filenames remain null and count as unavailable without removing the MS profile. Exclusions are mutually exclusive in status, file, unlinked lineage, outside published snapshot order.",
        "instruments": instruments, "profiles": profiles,
        "total_ms_records": len(rows["MS_Data"]),
        "gnps_filenames_unavailable": unavailable_filenames, **excluded,
    }


def build(env_file=None, output=OUT, samples=SAMPLES):
    published = published_samples(samples)
    if env_file is not None or os.environ.get("DIRECTUS_TOKEN") or os.environ.get("DIRECTUS_USERNAME"):
        base, token = credentials(env_file)
    else:
        base, token = DEFAULT_BASE, ""  # All requested collection fields are publicly readable.
    records = {name: fetch_all(name, fields, base, token) for name, fields in FIELDS.items()}
    snapshot = profile_snapshot(records, published, base, datetime.now(timezone.utc).isoformat())
    output = Path(output)
    temporary = output.with_suffix(output.suffix + ".tmp")
    temporary.write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    temporary.replace(output)
    print(f"Exported {len(snapshot['profiles'])} linked MS files from {snapshot['total_ms_records']} records to {output}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, help="Optional local Directus credentials file")
    parser.add_argument("--output", type=Path, default=OUT)
    parser.add_argument("--samples", type=Path, default=SAMPLES, help="Published samples snapshot")
    args = parser.parse_args()
    build(args.env_file, args.output, args.samples)
