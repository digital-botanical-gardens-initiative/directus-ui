#!/usr/bin/env python3
"""Export linked collector identities for the published sample snapshot."""

import argparse
import json
from collections import defaultdict
from datetime import datetime, timezone
import re
from pathlib import Path

if __package__:
    from . import build_snapshot
else:
    import build_snapshot

SAMPLES = Path(__file__).resolve().parents[1] / "data" / "samples.json"
OUT = SAMPLES.with_name("collectors.json")
FIELD_FIELDS = "id,sample_id,collector_ref,collector_fullname"
PEOPLE_FIELDS = "id,full_name,orcid,inat"
# Reviewed exact People IDs/names against https://www.dbgi.org/network/; avatar filenames come
# from the corresponding DBGI team pages. Missing portraits are not inferred from a person's name.
DBGI_TEAM_PAGES = {
    1: ("Audrey Le Cabec", "le-cabec-audrey", "avatar_hu_293ce090b2d62fcb.jpg"),
    4: ("Emmanuel Defossez", "defossez-emmanuel", "avatar_hu_3a41dc80ec9ea29d.jpeg"),
    5: ("Héloïse Coen", "coen-heloise", "avatar_hu_758b326ce901c05a.jpg"),
    10: ("Alžběta Kadlecová", "kadlecova-alzbeta", "avatar_hu_d26c6f8ff047f596.jpg"),
    11: ("Ana Claudia Sima", "sima-ana-claudia", "avatar_hu_8e65b7a63978c475.jpg"),
    12: ("Anna Maliukova", "maliukova-anna", "avatar_hu_1b8be4787473b723.jpg"),
    14: ("Davide Rovelli", "rovelli-davide", "avatar_hu_ca6d64f49a58bcdd.jpg"),
    15: ("Disha Tandon", "tandon-disha", "avatar_hu_fc84182964458047.jpeg"),
    16: ("Donat Agosti", "agosti-donat", "avatar_hu_abd7b22087c2ad8c.jpeg"),
    20: ("Kateřina Kučerová", "kucerova-katerina", "avatar_hu_f6fc1b7df650ae12.jpg"),
    21: ("Lise Lebrun", "lebrun-lise", None),
    25: ("Mazzarine Laboureau", "laboureau-mazzarine", "avatar_hu_fc3b726ad74471ab.png"),
    26: ("Maëlle Wannier", "wannier-maelle", "avatar_hu_f0cc2afea4593b20.jpg"),
    27: ("Pierre-Marie Allard", "allard-pierre-marie", "avatar_hu_c47592ed69beb97a.jpg"),
    29: ("Tito Damiani", "tito-damiani", "avatar_hu_fb82dd2dcc95cf51.jpg"),
}


def orcid_id(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{4}-\d{4}-[\dX]{4}", value):
        return None
    digits = value.replace("-", "")
    checksum = 0
    for digit in digits[:15]:
        checksum = (checksum + int(digit)) * 2
    expected = (12 - checksum % 11) % 11
    return value if digits[-1] == ("X" if expected == 10 else str(expected)) else None


def inat_handle(value):
    if not isinstance(value, str):
        return None
    handle = value.strip().removeprefix("@")
    return handle if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,59}", handle) else None


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
        people[person["id"]] = person

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
        name = people[person_id].get("full_name")
        if not isinstance(name, str) or not name.strip():
            raise ValueError(f"People {person_id} has no full_name")
        linked[person_id].append(field_id)
    missing = published.keys() - seen
    if missing:
        raise ValueError(f"Published Field_Data {min(missing)} is missing from Directus")

    collectors = []
    for person_id, field_ids in linked.items():
        person = people[person_id]
        name = person["full_name"].strip()
        collector = {"id": person_id, "name": name, "field_ids": sorted(field_ids)}
        if orcid := orcid_id(person.get("orcid")):
            collector["orcid"] = orcid
        if handle := inat_handle(person.get("inat")):
            collector["inat"] = handle
        profile = DBGI_TEAM_PAGES.get(person_id)
        if profile and name == profile[0]:
            collector["dbgi_profile"] = f"https://www.dbgi.org/team/{profile[1]}/"
            portrait = Path(__file__).resolve().parents[1] / "assets" / "collectors" / f"{person_id}.webp"
            if profile[2] and portrait.is_file():
                collector["portrait"] = f"assets/collectors/{person_id}.webp"
        collectors.append(collector)
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
