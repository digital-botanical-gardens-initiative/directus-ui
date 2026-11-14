#!/usr/bin/env python3
"""Publish minimal public iNaturalist observations linked to the existing DBGI sample snapshot."""

import ast
import json
import os
import re
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

if __package__:
    from . import build_snapshot as snapshot
else:
    import build_snapshot as snapshot

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "data" / "samples.json"
OUT = ROOT / "data" / "inaturalist.json"
FIELDS = "id,emi_external_id,community_taxon_id,taxon_id,taxon_name,taxon_rank,photo_url,photos,uri,comments_count"
API = "https://api.inaturalist.org/v1"
COLUMNS = ["sample_id", "field_id", "observation_id", "observer_taxon_id", "observer_name",
           "observer_rank", "community_taxon_id", "community_name", "community_rank",
           "col_id", "col_name", "col_rank", "status", "reason", "photos",
           "comments_count", "comments_source"]
PHOTO_HOSTS = {"inaturalist-open-data.s3.amazonaws.com", "static.inaturalist.org", "images.inaturalist.org"}
PHOTO_PATH = re.compile(r"/photos/([1-9][0-9]*)/square\.(?:jpg|jpeg|png)\Z")
COMPARABLE_RANKS = {"kingdom", "phylum", "class", "order", "family", "genus", "species",
                    "subspecies", "variety", "form"}
PAGE_SIZE = 500
BATCH_SIZE = 25
_next_api_request = 0.0


def positive_id(value, label):
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"Invalid {label}: {value!r}")
    return value


def optional_id(value, label):
    return None if value is None else positive_id(value, label)

def comment_count(value):
    """Only a nonnegative integral public count establishes comment presence or absence."""
    return value if type(value) is int and 0 <= value <= 9007199254740991 else None


def public_comments(directus, api):
    """Keep published positive evidence even when a later API lookup reports zero."""
    imported = comment_count(directus)
    if isinstance(api, dict):
        count = comment_count(api.get("comments_count"))
        if count is not None:
            if count == 0 and imported is not None and imported > 0:
                return imported, "Directus Curation_Data"
            return count, "iNaturalist API"
    return (imported, "Directus Curation_Data") if imported is not None else (None, None)


def photo_id(url):
    if not isinstance(url, str):
        return None
    parsed = urlsplit(url)
    if (parsed.scheme != "https" or parsed.hostname not in PHOTO_HOSTS or parsed.netloc != parsed.hostname
            or parsed.query or parsed.fragment):
        return None
    match = PHOTO_PATH.fullmatch(parsed.path)
    return int(match.group(1)) if match else None


def directus_photos(value, first_url, observation_id):
    """Decode the restricted legacy Python literal; never evaluate source code."""
    if value is None or value == "":
        parsed = []
    elif isinstance(value, str) and len(value) <= 50000:
        try:
            parsed = ast.literal_eval(value)
        except (ValueError, SyntaxError, TypeError, RecursionError) as error:
            raise ValueError(f"Malformed photos on observation {observation_id}") from error
    else:
        raise ValueError(f"Malformed photos on observation {observation_id}")
    if not isinstance(parsed, list) or len(parsed) > 50:
        raise ValueError(f"Malformed photos on observation {observation_id}")
    urls = []
    ids = set()
    for entry in parsed:
        if not isinstance(entry, dict) or len(entry) != 1:
            raise ValueError(f"Malformed photos on observation {observation_id}")
        key, url = next(iter(entry.items()))
        ident = photo_id(url)
        if ident is None or key != str(ident) or ident in ids:
            raise ValueError(f"Invalid or duplicate photo on observation {observation_id}")
        ids.add(ident)
        urls.append(url)
    if first_url is not None and (photo_id(first_url) is None or not urls or urls[0] != first_url):
        raise ValueError(f"photo_url does not match first photos entry on observation {observation_id}")
    return urls


def observation_url(value, observation_id):
    expected = f"https://www.inaturalist.org/observations/{observation_id}"
    if value != expected:
        raise ValueError(f"Invalid iNaturalist observation URL for {observation_id}: {value!r}")
    return expected


def get_api(path):
    """Rate-limit public lookups and honor transient iNaturalist throttling."""
    global _next_api_request
    for attempt in range(3):
        time.sleep(max(0, _next_api_request - time.monotonic()))
        _next_api_request = time.monotonic() + 2.5
        try:
            with urlopen(Request(API + path, headers={"User-Agent": "DBGI-static-dashboard/1.0"}), timeout=60) as response:
                data = json.load(response)
            if not isinstance(data, dict) or not isinstance(data.get("results"), list):
                raise ValueError(f"Malformed iNaturalist API result at {path}")
            return data["results"]
        except (HTTPError, URLError) as error:
            if isinstance(error, HTTPError) and error.code not in (429, 500, 502, 503, 504):
                raise
            if attempt == 2:
                raise
            retry_after = error.headers.get("Retry-After") if isinstance(error, HTTPError) else None
            delay = int(retry_after) if retry_after and retry_after.isdecimal() else 0
            time.sleep(max(delay, 15 * (attempt + 1) if isinstance(error, HTTPError) and error.code == 429
                           else 2 ** attempt))


def batches(items, size=BATCH_SIZE):
    for start in range(0, len(items), size):
        yield items[start:start + size]


def fetch_api_records(kind, ids):
    """The /v1/taxa/{ids} and /v1/observations/{ids} endpoints accept comma-separated IDs."""
    ids = sorted(set(ids))
    records = {}
    # iNaturalist is lookup-only: throttling or a deleted observation must not drop a Directus row.
    for batch in batches(ids):
        try:
            results = get_api(f"/{kind}/" + ",".join(map(str, batch)))
        except (HTTPError, URLError) as error:
            print(f"External iNaturalist {kind} lookup unavailable ({error}); retaining Directus records without this lookup")
            continue
        for item in results:
            if not isinstance(item, dict) or item.get("id") not in batch or item["id"] in records:
                raise ValueError(f"Malformed or duplicate iNaturalist {kind} response")
            records[item["id"]] = item
    return records


def name(value):
    return value.strip() if isinstance(value, str) and value.strip() else None


def rank(value):
    return value.strip().lower() if isinstance(value, str) and value.strip() else None


def compare(community_id, community, col):
    """A name comparison is not a claim that either taxonomy is erroneous."""
    if community_id is None:
        return "unassessable", "No iNaturalist community taxon ID"
    if community is None:
        return "unassessable", "iNaturalist community taxon could not be resolved"
    if col is None:
        return "unassessable", "Sample has no resolved CoL taxon"
    community_name, community_rank = name(community.get("name")), rank(community.get("rank"))
    col_name, col_rank = name(col[2]), rank(col[4])
    if not community_name or not col_name or community_rank not in COMPARABLE_RANKS or col_rank not in COMPARABLE_RANKS:
        return "unassessable", "Scientific name or comparable rank is unavailable"
    if community_rank != col_rank:
        return "unassessable", "Different taxonomic ranks"
    if community.get("is_active") is not True:
        return "unassessable", "iNaturalist community taxon is not an active accepted name"
    if normalized(community_name) == normalized(col_name):
        return "agreement", "Same scientific name at the same rank"
    return "potential disagreement", "Different scientific names at the same rank; synonymy/taxonomy requires review"


def normalized(value):
    return unicodedata.normalize("NFC", " ".join(value.split())).casefold()


def prepare(source, samples, communities, observation_metadata):
    """Reject duplicate or malformed source rows; retain every distinct linked observation."""
    if samples.get("columns") != snapshot_columns() or samples.get("taxon_columns") != snapshot_taxon_columns():
        raise ValueError("Unexpected samples.json schema")
    by_sample = {}
    for row in samples["rows"]:
        if row[1] in by_sample:
            raise ValueError(f"Ambiguous sample ID {row[1]}")
        by_sample[row[1]] = row
    taxa = {taxon[0]: taxon for taxon in samples["taxa"]}
    if len(taxa) != len(samples["taxa"]):
        raise ValueError("Duplicate Taxa IDs in samples.json")
    output = []
    seen = set()
    linked_samples = set()
    for row in source:
        if not isinstance(row, dict):
            raise ValueError("Malformed Curation_Data row")
        obs_id = positive_id(row.get("id"), "observation ID")
        if obs_id in seen:
            raise ValueError(f"Duplicate Curation_Data observation ID {obs_id}")
        seen.add(obs_id)
        sample_id = row.get("emi_external_id")
        if sample_id not in by_sample:
            continue
        linked_samples.add(sample_id)
        observation_url(row.get("uri"), obs_id)
        observer_id = optional_id(row.get("taxon_id"), "observer taxon ID")
        community_id = optional_id(row.get("community_taxon_id"), "community taxon ID")
        photo_urls = directus_photos(row.get("photos"), row.get("photo_url"), obs_id)
        sample = by_sample[sample_id]
        col = taxa.get(sample[7])
        if sample[7] is not None and col is None:
            raise ValueError(f"Missing CoL Taxa record {sample[7]}")
        community = communities.get(community_id) if community_id is not None else None
        status, reason = compare(community_id, community, col)
        metadata = observation_metadata.get(obs_id)
        api_photos = {photo["id"]: photo for photo in metadata.get("photos", [])
                      if isinstance(photo, dict) and type(photo.get("id")) is int} if isinstance(metadata, dict) and isinstance(metadata.get("photos"), list) else {}
        photos = []
        for url in photo_urls:
            matched = api_photos.get(photo_id(url))
            photos.append([url, name(matched.get("attribution")) if matched else None,
                           name(matched.get("license_code")) if matched else None])
        comments_count, comments_source = public_comments(row.get("comments_count"), metadata)
        output.append([sample_id, sample[0], obs_id, observer_id, name(row.get("taxon_name")),
                       rank(row.get("taxon_rank")), community_id, name(community.get("name")) if community else None,
                       rank(community.get("rank")) if community else None,
                       col[1] if col else None, col[2] if col else None, col[4] if col else None,
                       status, reason, photos, comments_count, comments_source])
    output.sort(key=lambda row: (row[0], row[2]))
    return output, len(linked_samples)


def snapshot_columns():
    return ["directus_id", "sample_id", "project", "recorded_taxon", "longitude", "latitude", "date", "taxon_id", "resolution_status", "observation_subject"]


def snapshot_taxon_columns():
    return ["id", "col_id", "scientific_name", "authorship", "rank", "parent_id", "backbone_version"]


def build():
    samples = json.loads(SAMPLES.read_text(encoding="utf-8"))
    base = samples["source"].rstrip("/")
    parsed = urlsplit(base)
    if (parsed.scheme != "https" or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.hostname != "emi-collection.unifr.ch" or parsed.path != "/directus"):
        raise ValueError("samples.json source is not the expected public Directus instance")
    # Anonymous public Curation_Data is sufficient; optional DIRECTUS_TOKEN needs read-only access.
    token = os.environ.get("DIRECTUS_TOKEN") or None
    source = snapshot.fetch_all("Curation_Data", FIELDS, base, token) if token else fetch_public(base)
    sample_ids = {sample[1] for sample in samples["rows"]}
    linked = [row for row in source if isinstance(row, dict) and row.get("emi_external_id") in sample_ids]
    communities = fetch_api_records("taxa", [row["community_taxon_id"] for row in linked
                                               if row.get("community_taxon_id") is not None])
    # No lookup for a community ID => explicitly unassessable, never substitute the observer's taxon.
    # Only matched iNaturalist photo IDs corroborate attribution; Directus remains the source of image URLs.
    # Look up every linked observation, not only those with photos: a newer public comment
    # count may differ from the Directus import. Failed/missing lookups retain Directus counts.
    observation_metadata = fetch_api_records("observations", [row["id"] for row in linked])
    # A deleted/private API observation does not invalidate the Directus image, count or source URL.
    rows, sample_count = prepare(source, samples, communities, observation_metadata)
    if not rows:
        raise ValueError("No Curation_Data observations joined to the existing sample snapshot")
    result = {"source": base + "/items/Curation_Data", "inaturalist_api": API,
              "provenance": {
                  "observation_id,sample_id,observer_taxon_id,observer_name,observer_rank,photos[*][0]": "Directus Curation_Data",
                  "field_id,col_id,col_name,col_rank": "Directus Field_Data and Taxa via data/samples.json",
                  "community_name,community_rank,photos[*][1],photos[*][2]": "External iNaturalist API lookup, matched by observation and photo ID (never observation source)",
                  "comments_count,comments_source": "Nonnegative public iNaturalist API observations.comments_count when available, otherwise public Directus Curation_Data.comments_count; a positive imported count is retained if the newer API reports zero. Null means unknown. Comment bodies and Directus comments are never exported.",
                  "join": "Curation_Data.emi_external_id = Field_Data.sample_id",
                  "comparison": "Accepted scientific names at equal comparable rank; different names are only potential disagreements"},
              "sample_generated_at": samples["generated_at"],
              "generated_at": datetime.now(timezone.utc).isoformat(), "source_count": len(source),
              "linked_samples": sample_count, "columns": COLUMNS, "rows": rows}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUT.with_suffix(".json.tmp")
    try:
        temporary.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        temporary.replace(OUT)
    finally:
        temporary.unlink(missing_ok=True)
    print(f"Exported {len(rows)} observations for {sample_count} samples to {OUT}")


def fetch_public(base):
    """Directus exposes public Curation_Data without reading Field_Data or credentials."""
    def get(params):
        request = Request(base + "/items/Curation_Data?" + urlencode(params),
                          headers={"User-Agent": "DBGI-static-dashboard/1.0"})
        with urlopen(request, timeout=60) as response:
            payload = json.load(response)
        if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
            raise ValueError("Malformed public Curation_Data response")
        return payload["data"]
    expected = int(get({"aggregate[count]": "id"})[0]["count"]["id"])
    rows = []
    while len(rows) < expected:
        page = get({"fields": FIELDS, "sort": "id", "limit": PAGE_SIZE, "offset": len(rows)})
        if not page:
            raise ValueError("Incomplete public Curation_Data export")
        rows.extend(page)
    if len(rows) != expected or int(get({"aggregate[count]": "id"})[0]["count"]["id"]) != expected:
        raise ValueError("Curation_Data count changed during export; retry")
    return rows


if __name__ == "__main__":
    build()
