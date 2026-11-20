#!/usr/bin/env python3
"""Stage the same static application with either the full EMI data or DBGI gardens."""

import argparse
import json
import re
import shutil
import tempfile
import warnings
from collections import Counter
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
DATA_FILES = ("samples", "gardens", "garden_progress", "collectors", "processing",
              "ms_profile", "inaturalist", "wikidata_taxa")
REFRESH_FILES = ("samples", "collectors", "garden_progress", "ms_profile", "processing", "inaturalist")
STATIC_FILES = ("index.html", "LICENSE", "LICENSING.md")
GARDEN_IDS = {"fribourg", "champex", "neuchatel", "prague", "kew"}
SAMPLE_COLUMNS = ["directus_id", "sample_id", "project", "recorded_taxon", "longitude",
                  "latitude", "date", "taxon_id", "resolution_status", "observation_subject"]
TAXON_COLUMNS = ["id", "col_id", "scientific_name", "authorship", "rank", "parent_id", "backbone_version"]
PROCESSING_COLUMNS = ["kind", "id", "field_id", "container_id", "container_label",
                      "parent_container_id", "status"]
INAT_COLUMNS = ["sample_id", "field_id", "observation_id", "observer_taxon_id", "observer_name",
                "observer_rank", "community_taxon_id", "community_name", "community_rank",
                "col_id", "col_name", "col_rank", "status", "reason", "photos",
                "comments_count", "comments_source"]

ALLOWED_KEYS = {
    "samples": {"source", "generated_at", "total_rows", "columns", "taxon_columns", "taxa", "rows"},
    "garden_progress": {"source", "generated_at", "method", "total_samples", "gardens",
                        "record_statuses", "unlinked_processing_records", "ms_without_extraction_samples"},
    "collectors": {"source", "generated_at", "sample_snapshot_generated_at", "total_field_rows",
                   "unlinked_named_samples", "collectors"},
    "processing": {"source", "generated_at", "columns", "records", *(
        f"{prefix}_{kind}{suffix}" for prefix, suffix in (
            ("total", "_records"), ("excluded_unlinked", ""), ("excluded_outside_snapshot", "")
        ) for kind in ("dried", "extract", "aliquot", "ms"))},
    "ms_profile": {"source", "generated_at", "method", "instruments", "injection_methods",
                   "profiles", "total_ms_records", "gnps_filenames_unavailable",
                   "excluded_unlinked_ms", "excluded_outside_snapshot_ms",
                   "excluded_without_file_ms", "excluded_other_status_ms"},
    "inaturalist": {"source", "generated_at", "sample_generated_at", "columns", "rows",
                    "linked_samples", "source_count", "inaturalist_api", "provenance"},
    "wikidata_taxa": {"source", "property", "generated_at", "rows", "requested_ids",
                      "matched_ids", "ambiguous_ids", "unmatched_ids"},
}


def positive_id(value):
    return type(value) is int and value > 0


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def require(condition, message):
    if not condition:
        raise ValueError(message)


def load_catalog(catalog):
    """Validate the editable, exclusive project-to-garden mapping before publishing."""
    require(isinstance(catalog, dict) and set(catalog) == {"gardens"}
            and isinstance(catalog["gardens"], list) and len(catalog["gardens"]) == 5,
            "Garden catalog must contain exactly five gardens")
    aliases, names, urls, ids = {}, set(), set(), set()
    for garden in catalog["gardens"]:
        require(isinstance(garden, dict) and set(garden) == {"id", "name", "aliases", "url"},
                "Invalid garden catalog entry")
        garden_id, name, url = garden["id"], garden["name"], garden["url"]
        require(isinstance(garden_id, str) and re.fullmatch(r"[a-z0-9-]+", garden_id)
                and garden_id in GARDEN_IDS and garden_id not in ids, "Invalid or duplicate garden id")
        require(nonempty(name) and name == name.strip() and name not in names, "Invalid garden name")
        address = urlsplit(url) if isinstance(url, str) else None
        require(address is not None and address.scheme == "https" and address.netloc == "www.dbgi.org"
                and address.path == f"/gardens/{garden_id}/" and not address.query and not address.fragment
                and url not in urls, "Invalid garden URL")
        ids.add(garden_id)
        names.add(name)
        urls.add(url)
        projects = garden["aliases"]
        require(isinstance(projects, list) and bool(projects), f"Missing aliases for {garden_id}")
        for project in projects:
            require(isinstance(project, str) and re.fullmatch(r"[a-z0-9][a-z0-9_-]*", project)
                    and project not in aliases and project not in GARDEN_IDS,
                    f"Invalid or duplicate project alias {project!r}")
            aliases[project] = garden_id
    require(ids == GARDEN_IDS, "Garden catalog must identify the five configured gardens")
    return aliases


def rows_of(snapshot, key, label):
    require(isinstance(snapshot, dict) and isinstance(snapshot.get(key), list), f"Invalid {label} snapshot")
    return snapshot[key]


def scoped_samples(snapshot, aliases):
    require(isinstance(snapshot, dict) and snapshot.get("columns") == SAMPLE_COLUMNS
            and snapshot.get("taxon_columns") == TAXON_COLUMNS, "Unexpected samples schema")
    source_rows = rows_of(snapshot, "rows", "samples")
    taxa = rows_of(snapshot, "taxa", "samples")
    taxon_by_id = {}
    for taxon in taxa:
        require(isinstance(taxon, list) and len(taxon) == len(TAXON_COLUMNS)
                and positive_id(taxon[0]) and taxon[0] not in taxon_by_id
                and nonempty(taxon[1]) and nonempty(taxon[2]) and nonempty(taxon[4])
                and (taxon[5] is None or positive_id(taxon[5])), "Malformed or duplicate Taxa row")
        taxon_by_id[taxon[0]] = taxon
    verified = set()
    for taxon in taxa:
        path = set()
        current = taxon[0]
        while current is not None and current not in verified:
            require(current in taxon_by_id and current not in path,
                    f"Broken Taxa ancestry at {current}")
            path.add(current)
            current = taxon_by_id[current][5]
        verified.update(path)
    sample_ids, field_ids, selected, groups = set(), set(), [], Counter()
    for row in source_rows:
        require(isinstance(row, list) and len(row) == len(SAMPLE_COLUMNS)
                and positive_id(row[0]) and row[0] not in field_ids
                and nonempty(row[1]) and row[1] not in sample_ids
                and (row[2] is None or isinstance(row[2], str))
                and (row[7] is None or positive_id(row[7])), "Malformed or duplicate sample row")
        require(row[7] is None or row[7] in taxon_by_id, f"Sample {row[0]} references missing Taxa")
        field_ids.add(row[0])
        sample_ids.add(row[1])
        garden = aliases.get(row[2])
        if garden is None:
            continue
        selected.append([*row[:2], garden, *row[3:]])
        groups[garden] += 1
    require(bool(selected) and all(groups[garden] for garden in GARDEN_IDS),
            "One or more configured gardens have no samples")
    included = set()
    for row in selected:
        current = row[7]
        while current is not None and current not in included:
            included.add(current)
            current = taxon_by_id[current][5]
    result = {key: value for key, value in snapshot.items() if key not in ("rows", "taxa", "total_rows")}
    result.update(site="dbgi", rows=selected, taxa=[row for row in taxa if row[0] in included],
                  total_rows=len(selected))
    return result, groups, {row[0]: row for row in selected}


def scoped_progress(snapshot, catalog, groups):
    gardens = rows_of(snapshot, "gardens", "garden progress")
    by_id = {}
    for garden in gardens:
        require(isinstance(garden, dict) and isinstance(garden.get("id"), str)
                and garden["id"] not in by_id, "Invalid or duplicate garden progress entry")
        by_id[garden["id"]] = garden
    require(set(by_id) == GARDEN_IDS and snapshot.get("total_samples") == sum(groups.values()),
            "Garden progress does not match samples")
    staged = []
    for garden in catalog["gardens"]:
        item = by_id[garden["id"]]
        require(item.get("garden") == garden["name"] and item.get("projects") == garden["aliases"]
                and item.get("samples") == groups[garden["id"]],
                f"Garden progress differs from {garden['id']} sample group")
        stages = (item.get("collected_only"), item.get("extraction_record_present"),
                  item.get("ms_record_present"))
        require(all(type(count) is int and count >= 0 for count in stages)
                and sum(stages) == item["samples"], "Invalid garden stage totals")
        staged.append({**item, "projects": [garden["id"]]})
    require(type(snapshot.get("ms_without_extraction_samples")) is int
            and 0 <= snapshot["ms_without_extraction_samples"] <= sum(g["ms_record_present"] for g in staged),
            "Invalid garden MS count")
    result = {key: value for key, value in snapshot.items()
              if key not in ("gardens", "record_statuses", "unlinked_processing_records")}
    result.update(site="dbgi", gardens=staged)
    if "method" in result:
        result["method"] = result["method"].replace(
            " Status counts describe records, not verified success or instrument files.", "")
    return result


def scoped_collectors(snapshot, selected, source_fields, samples, root):
    require(snapshot.get("source") == samples.get("source")
            and snapshot.get("sample_snapshot_generated_at") == samples.get("generated_at"),
            "Collector/sample provenance differs")
    people, assigned = [], set()
    for person in rows_of(snapshot, "collectors", "collectors"):
        require(isinstance(person, dict) and positive_id(person.get("id"))
                and nonempty(person.get("name")) and isinstance(person.get("field_ids"), list),
                "Invalid collector")
        linked = []
        for field_id in person["field_ids"]:
            require(positive_id(field_id) and field_id in source_fields
                    and field_id not in assigned, "Collector has invalid or duplicate Field_Data link")
            assigned.add(field_id)
            if field_id in selected:
                linked.append(field_id)
        if linked:
            portrait = person.get("portrait")
            require(portrait is None or portrait == f"assets/collectors/{person['id']}.webp",
                    "Invalid collector portrait path")
            require(portrait is None or (root / portrait).is_file(),
                    "Missing collector portrait")
            people.append({**person, "field_ids": linked})
    require(len({person["id"] for person in people}) == len(people), "Duplicate collector identity")
    return {**snapshot, "site": "dbgi", "total_field_rows": len(selected),
            "unlinked_named_samples": None, "collectors": people}


def scoped_processing(snapshot, selected, source_fields):
    require(snapshot.get("columns") == PROCESSING_COLUMNS, "Unexpected processing schema")
    records, source_records, seen = [], [], set()
    for row in rows_of(snapshot, "records", "processing"):
        require(isinstance(row, list) and len(row) == len(PROCESSING_COLUMNS)
                and row[0] in ("dried", "extract", "aliquot", "ms") and positive_id(row[1])
                and positive_id(row[2]) and row[2] in source_fields and (row[0], row[1]) not in seen,
                "Malformed or duplicate processing record")
        seen.add((row[0], row[1]))
        require((row[3] is None and row[4] is None) if row[0] == "ms" else
                (positive_id(row[3]) and isinstance(row[4], str)), "Invalid processing container")
        require(row[5] is None or positive_id(row[5]), "Invalid processing parent container")
        source_records.append(row)
        if row[2] in selected:
            records.append(row)
    # A parent may be an unexported field root. But if its container appears
    # in this export, its owner must agree even when that owner is outside scope.
    owners = {}
    for row in source_records:
        if row[3] is not None:
            owner = owners.setdefault(row[3], row[2])
            require(owner == row[2], "Conflicting processing container ownership")
    for row in records:
        require(row[5] not in owners or owners[row[5]] == row[2],
                "Conflicting processing parent ancestry")
    result = {key: value for key, value in snapshot.items()
              if not key.startswith(("total_", "excluded_")) and key != "records"}
    result["records"] = records
    for kind in ("dried", "extract", "aliquot", "ms"):
        result[f"total_{kind}_records"] = sum(row[0] == kind for row in records)
    return result


def scoped_ms(snapshot, selected, source_fields):
    instruments, methods = {}, {}
    for key, target, width in (("instruments", instruments, 3), ("injection_methods", methods, 2)):
        for row in rows_of(snapshot, key, "MS profile"):
            require(isinstance(row, list) and len(row) == width and positive_id(row[0])
                    and row[0] not in target, f"Malformed or duplicate {key}")
            if key == "instruments":
                require(nonempty(row[1]) and nonempty(row[2]), "Invalid instrument")
            else:
                require(row[1] in ("positive", "negative", None), "Invalid injection method")
            target[row[0]] = row
    result_profiles, used_instruments, used_methods, seen = [], set(), set(), set()
    for row in rows_of(snapshot, "profiles", "MS profile"):
        require(isinstance(row, list) and len(row) == 6 and positive_id(row[0])
                and row[0] not in seen and positive_id(row[1]) and row[1] in source_fields,
                "Malformed or duplicate MS profile")
        seen.add(row[0])
        require(positive_id(row[2]) and row[3] in ("OK", "published")
                and (row[4] is None or (nonempty(row[4]) and "/" not in row[4] and "\\" not in row[4]))
                and (row[5] is None or positive_id(row[5])),
                "Invalid MS profile relation or filename")
        if row[1] not in selected:
            continue
        require(row[2] in instruments and (row[5] is None or row[5] in methods),
                f"MS profile {row[0]} references missing instrument or injection method")
        used_instruments.add(row[2])
        if row[5] is not None:
            used_methods.add(row[5])
        result_profiles.append(row)
    result = {key: value for key, value in snapshot.items()
              if key not in ("profiles", "instruments", "injection_methods", "total_ms_records",
                             "gnps_filenames_unavailable") and not key.startswith("excluded_")}
    result.update(profiles=result_profiles,
                  instruments=[row for row in instruments.values() if row[0] in used_instruments],
                  injection_methods=[row for row in methods.values() if row[0] in used_methods],
                  gnps_filenames_unavailable=sum(row[4] is None for row in result_profiles))
    if "method" in result:
        result["method"] = result["method"].split(" Exclusions are mutually exclusive")[0]
    return result


def scoped_inaturalist(snapshot, selected, samples, source_fields):
    require(snapshot.get("columns") == INAT_COLUMNS
            and snapshot.get("sample_generated_at") == samples.get("generated_at"),
            "Curation/sample provenance or schema differs")
    result_rows, seen = [], set()
    selected_names = {sample[1] for sample in selected.values()}
    for row in rows_of(snapshot, "rows", "iNaturalist"):
        require(isinstance(row, list) and len(row) == len(INAT_COLUMNS) and nonempty(row[0])
                and positive_id(row[1]) and positive_id(row[2]) and row[2] not in seen,
                "Malformed or duplicate iNaturalist observation")
        require(isinstance(row[14], list) and all(
            isinstance(photo, list) and len(photo) == 3 and nonempty(photo[0])
            and all(value is None or isinstance(value, str) for value in photo[1:])
            for photo in row[14]), "Malformed iNaturalist photos")
        require((row[15] is None or type(row[15]) is int and row[15] >= 0)
                and (row[16] is None or isinstance(row[16], str)),
                "Malformed iNaturalist comment count")
        seen.add(row[2])
        source_sample = source_fields.get(row[1])
        require(source_sample is not None and row[0] == source_sample[1],
                f"Curation observation {row[2]} references mismatched sample identity")
        if row[1] not in selected and row[0] not in selected_names:
            continue
        sample = selected.get(row[1])
        require(sample is not None and row[0] == sample[1],
                f"Curation observation {row[2]} references mismatched sample identity")
        result_rows.append(row)
    result = {key: value for key, value in snapshot.items() if key not in ("rows", "linked_samples", "source_count")}
    result.update(rows=result_rows, linked_samples=len({row[0] for row in result_rows}))
    return result


def scoped_wikidata(snapshot, samples):
    taxa = {row[0]: row for row in samples["taxa"]}
    species = set()
    for sample in samples["rows"]:
        taxon = taxa.get(sample[7])
        while taxon is not None and taxon[4] != "species":
            taxon = taxa.get(taxon[5])
        if taxon is not None:
            species.add(taxon[1])
    seen, rows = set(), []
    for row in rows_of(snapshot, "rows", "Wikidata"):
        require(isinstance(row, list) and len(row) == 2 and nonempty(row[0])
                and isinstance(row[1], str) and re.fullmatch(r"Q[1-9][0-9]*", row[1]),
                "Malformed Wikidata match")
        require(row[0] not in seen, "Duplicate Wikidata CoL ID")
        seen.add(row[0])
        if row[0] in species:
            rows.append(row)
    require(all(row[0] in species for row in rows), "Foreign Wikidata match")
    result = {key: value for key, value in snapshot.items()
              if key not in ("rows", "matched_ids", "requested_ids", "ambiguous_ids", "unmatched_ids")}
    result.update(rows=rows, matched_ids=len(rows), requested_ids=len(species))
    # The source does not identify which *unmatched or ambiguous* IDs were in
    # each garden. Neither global count can truthfully be projected.
    return result


def timestamp(value, label):
    require(nonempty(value), f"Missing {label} timestamp")
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as error:
        raise ValueError(f"Invalid {label} timestamp") from error
    require(parsed.tzinfo is not None and parsed.utcoffset() is not None,
            f"Unzoned {label} timestamp")
    return parsed


def refresh_is_current(marker, source):
    """An optional completion claim must agree with all six exported snapshots."""
    try:
        require(isinstance(marker, dict) and marker.get("sample_generated_at")
                == source["samples"].get("generated_at")
                and isinstance(marker.get("snapshots"), dict)
                and set(marker["snapshots"]) == set(REFRESH_FILES),
                "Invalid refresh manifest")
        completed = timestamp(marker.get("completed_at"), "refresh completion")
        sample_time = timestamp(source["samples"].get("generated_at"), "samples")
        for key in REFRESH_FILES:
            generated = timestamp(source[key].get("generated_at"), key)
            require(marker["snapshots"][key] == source[key]["generated_at"]
                    and sample_time <= generated <= completed,
                    f"Stale or inconsistent refresh marker for {key}")
        return True
    except (ValueError, TypeError):
        return False


def validate_provenance(source):
    for name, allowed in ALLOWED_KEYS.items():
        snapshot = source[name]
        require(isinstance(snapshot, dict) and not set(snapshot).difference(allowed),
                f"Invalid or unknown {name} snapshot data")
    samples = source["samples"]
    require(nonempty(samples.get("source")), "Missing samples source")
    base = samples["source"].rstrip("/")
    sample_time = timestamp(samples.get("generated_at"), "samples")
    for key in REFRESH_FILES:
        require(timestamp(source[key].get("generated_at"), key) >= sample_time,
                f"{key} snapshot predates samples")
        if key in ("samples", "collectors"):
            expected = base
        elif key == "inaturalist":
            expected = base + "/items/Curation_Data"
        else:
            expected = base + "/items/"
        require(source[key].get("source") == expected, f"{key} belongs to another source")
    require(source["collectors"].get("sample_snapshot_generated_at") == samples["generated_at"]
            and source["inaturalist"].get("sample_generated_at") == samples["generated_at"],
            "Linked snapshots do not share the samples generation")
    if "refresh" in source:
        require(refresh_is_current(source["refresh"], source), "Invalid refresh manifest")


def dbgi_snapshots(source, root):
    catalog = source["gardens"]
    aliases = load_catalog(catalog)
    validate_provenance(source)
    require(source["wikidata_taxa"].get("property") == "P10585"
            and source["wikidata_taxa"].get("source") == "https://query.wikidata.org/sparql",
            "Unexpected Wikidata taxon mapping")
    samples, groups, selected = scoped_samples(source["samples"], aliases)
    source_fields = {row[0]: row for row in source["samples"]["rows"]}
    staged = {"samples": samples,
              "gardens": {"gardens": [{**garden, "aliases": [garden["id"]]}
                                     for garden in catalog["gardens"]]},
              "garden_progress": scoped_progress(source["garden_progress"], catalog, groups),
              "collectors": scoped_collectors(source["collectors"], selected, source_fields,
                                               source["samples"], root),
              "processing": scoped_processing(source["processing"], selected, source_fields),
              "ms_profile": scoped_ms(source["ms_profile"], selected, source_fields),
              "inaturalist": scoped_inaturalist(source["inaturalist"], selected, samples, source_fields),
              "wikidata_taxa": scoped_wikidata(source["wikidata_taxa"], samples)}
    processing_ms = {row[1]: row[2] for row in staged["processing"]["records"] if row[0] == "ms"}
    for profile in staged["ms_profile"]["profiles"]:
        require(processing_ms.get(profile[0]) == profile[1],
                f"MS profile {profile[0]} differs from processing lineage")
    staged["ms_profile"]["total_ms_records"] = staged["processing"]["total_ms_records"]
    taxa = {taxon[0]: taxon for taxon in samples["taxa"]}
    for row in staged["inaturalist"]["rows"]:
        sample = selected[row[1]]
        taxon = taxa.get(sample[7])
        require(row[9:12] == ([taxon[1], taxon[2], taxon[4]] if taxon else [None] * 3),
                f"Curation observation {row[2]} differs from sample Taxa")
    return staged


def stage(site, output=ROOT / "site", root=ROOT):
    """Publish a whitelist of static assets; do not expose inputs or partial DBGI snapshots."""
    require(site in ("dbgi", "emi"), "Site must be dbgi or emi")
    root, output = Path(root).resolve(), Path(output).resolve()
    require(output not in (root, *root.parents) and output != root / "assets"
            and output != root / "data" and root / "assets" not in output.parents
            and root / "data" not in output.parents,
            "Output cannot overwrite source")
    require(not output.exists() or (output.is_dir() and not any(output.iterdir())),
            "Output directory is not empty")
    data = root / "data"
    source = {name: json.loads((data / f"{name}.json").read_text(encoding="utf-8"))
              for name in DATA_FILES}
    marker_file = data / "refresh.json"
    include_refresh = False
    if marker_file.is_file():
        marker = json.loads(marker_file.read_text(encoding="utf-8"))
        include_refresh = refresh_is_current(marker, source)
        if include_refresh:
            source["refresh"] = marker
        else:
            warnings.warn("Ignoring stale or inconsistent optional refresh marker", stacklevel=2)
    if site == "dbgi":
        scoped = dbgi_snapshots(source, root)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".stage-site-", dir=output.parent) as temp:
        destination = Path(temp)
        for filename in STATIC_FILES:
            shutil.copy2(root / filename, destination / filename)
        portraits = ({Path(person["portrait"]).name for person in scoped["collectors"]["collectors"]
                      if "portrait" in person} if site == "dbgi" else None)
        def excluded_portraits(directory, names):
            if portraits is not None and Path(directory) == root / "assets" / "collectors":
                return [name for name in names if name not in portraits]
            return []
        shutil.copytree(root / "assets", destination / "assets",
                        ignore=excluded_portraits if site == "dbgi" else None)
        (destination / "data").mkdir()
        for filename in DATA_FILES:
            target = destination / "data" / f"{filename}.json"
            if site == "emi":
                shutil.copy2(data / target.name, target)
            else:
                target.write_text(json.dumps(scoped[filename], ensure_ascii=False, separators=(",", ":")) + "\n",
                                  encoding="utf-8")
        if include_refresh:
            shutil.copy2(marker_file, destination / "data" / "refresh.json")
        if output.exists():
            output.rmdir()  # Only an empty directory can pass the preflight.
        shutil.move(str(destination), str(output))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", required=True, choices=("dbgi", "emi"))
    parser.add_argument("--output", type=Path, default=ROOT / "site")
    options = parser.parse_args()
    stage(options.site, options.output)
