#!/usr/bin/env python3
"""Reconcile sampled Directus species CoL IDs against Wikidata P10585.

Run from the repository with ``python3 scripts/build_wikidata_taxa.py``. Queries
are bounded to 100 IDs and spaced by one second to respect the public WDQS
service; no browser or Directus credentials are used. A failed batch leaves the
existing snapshot untouched rather than publishing an incomplete reconciliation.
"""

import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "data" / "samples.json"
OUT = ROOT / "data" / "wikidata_taxa.json"
ENDPOINT = "https://query.wikidata.org/sparql"
PROPERTY = "P10585"
SPECIES_RANK = "Q7432"
BATCH_SIZE = 100
REQUEST_INTERVAL = 1.0
COL_ID = re.compile(r"[A-Za-z0-9]+\Z")
QID_URI = re.compile(r"https?://www\.wikidata\.org/entity/(Q[1-9][0-9]*)\Z")
_next_request = 0.0


def species_ids(snapshot):
    """Use only sample Taxa links and their recorded species parent lineage."""
    taxa = snapshot["taxa"]
    by_id = {}
    for taxon in taxa:
        if (not isinstance(taxon, list) or len(taxon) != 7
                or type(taxon[0]) is not int or taxon[0] <= 0 or taxon[0] in by_id):
            raise ValueError("Malformed or duplicate Taxa ID in samples snapshot")
        by_id[taxon[0]] = taxon

    selected = set()
    for sample in snapshot["rows"]:
        taxon_id = sample[7]
        if taxon_id is None:
            continue
        if type(taxon_id) is not int or taxon_id not in by_id:
            raise ValueError(f"Sample references missing Taxa ID {taxon_id!r}")
        taxon = by_id[taxon_id]
        seen = {taxon_id}
        while taxon[4] != "species":
            parent_id = taxon[5]
            if parent_id is None:
                break
            if type(parent_id) is not int or parent_id in seen or parent_id not in by_id:
                raise ValueError(f"Invalid Taxa parent chain for {taxon_id}")
            seen.add(parent_id)
            taxon = by_id[parent_id]
        if taxon[4] == "species":
            selected.add(taxon[0])

    ids = set()
    for taxon_id in selected:
        col_id = by_id[taxon_id][1]
        if not isinstance(col_id, str) or not COL_ID.fullmatch(col_id):
            raise ValueError(f"Invalid species CoL ID on Taxa {taxon_id}")
        ids.add(col_id)
    if not ids:
        raise ValueError("No sampled species CoL IDs; refusing an empty snapshot")
    return sorted(ids)


def query_for(ids):
    # Strict CoL ID character checks above keep literal interpolation unambiguous.
    return ("SELECT ?col ?item WHERE { VALUES ?col { "
            + " ".join(f'"{col_id}"' for col_id in ids)
            + f" }} ?item wdt:{PROPERTY} ?col ; wdt:P105 wd:{SPECIES_RANK} . }}")


def fetch_batch(ids):
    """Fetch one complete, bounded WDQS JSON result; retry only transient failures."""
    global _next_request
    query = query_for(ids)
    url = ENDPOINT + "?" + urlencode({"query": query, "format": "json"})
    for attempt in range(3):
        time.sleep(max(0, _next_request - time.monotonic()))
        _next_request = time.monotonic() + REQUEST_INTERVAL
        try:
            request = Request(url, headers={
                "Accept": "application/sparql-results+json",
                "User-Agent": "DBGI-static-dashboard/1.0 (public static species reconciliation)",
            })
            with urlopen(request, timeout=60) as response:
                return json.load(response)
        except (HTTPError, URLError, TimeoutError) as error:
            if isinstance(error, HTTPError) and error.code not in (429, 500, 502, 503, 504):
                raise
            if attempt == 2:
                raise
            retry_after = error.headers.get("Retry-After") if isinstance(error, HTTPError) else None
            delay = int(retry_after) if retry_after and retry_after.isdecimal() else 0
            time.sleep(max(min(delay, 120), 5 * (attempt + 1)))


def parse_bindings(payload, requested):
    """Reject malformed, foreign or non-species-query results, never infer missing matches."""
    if (not isinstance(payload, dict) or set(payload) != {"head", "results"}
            or not isinstance(payload["head"], dict)
            or not isinstance(payload["head"].get("vars"), list)
            or set(payload["head"]["vars"]) != {"col", "item"}
            or not isinstance(payload["results"], dict)
            or not isinstance(payload["results"].get("bindings"), list)):
        raise ValueError("Incomplete or malformed Wikidata SPARQL result")
    matches = {}
    for binding in payload["results"]["bindings"]:
        if not isinstance(binding, dict) or set(binding) != {"col", "item"}:
            raise ValueError("Malformed Wikidata binding")
        col, item = binding["col"], binding["item"]
        if (not isinstance(col, dict) or col.get("type") != "literal"
                or not isinstance(col.get("value"), str) or col["value"] not in requested
                or not isinstance(item, dict) or item.get("type") != "uri"
                or not isinstance(item.get("value"), str)):
            raise ValueError("Unexpected Wikidata CoL ID or entity binding")
        qid = QID_URI.fullmatch(item["value"])
        if qid is None:
            raise ValueError("Invalid Wikidata entity QID")
        matches.setdefault(col["value"], set()).add(qid.group(1))
    return matches


def reconcile(ids, fetch=None):
    fetch = fetch or fetch_batch
    matches = {}
    for start in range(0, len(ids), BATCH_SIZE):
        batch = ids[start:start + BATCH_SIZE]
        for col_id, qids in parse_bindings(fetch(batch), set(batch)).items():
            matches.setdefault(col_id, set()).update(qids)
    ambiguous = sum(len(qids) > 1 for qids in matches.values())
    rows = [[col_id, next(iter(matches[col_id]))] for col_id in ids
            if col_id in matches and len(matches[col_id]) == 1]
    if not rows:
        raise ValueError("No unambiguous Wikidata species matches; retaining prior snapshot")
    return rows, {"requested_ids": len(ids), "matched_ids": len(rows),
                  "unmatched_ids": len(ids) - len(matches), "ambiguous_ids": ambiguous}


def build():
    ids = species_ids(json.loads(SAMPLES.read_text(encoding="utf-8")))
    rows, counts = reconcile(ids)
    result = {"source": ENDPOINT, "property": PROPERTY,
              "generated_at": datetime.now(timezone.utc).isoformat(), "rows": rows, **counts}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUT.with_suffix(".json.tmp")
    try:
        temporary.write_text(json.dumps(result, separators=(",", ":")) + "\n", encoding="utf-8")
        temporary.replace(OUT)
    finally:
        temporary.unlink(missing_ok=True)
    print(f"Reconciled {len(rows)} sampled species ({counts['ambiguous_ids']} ambiguous) to {OUT}")


if __name__ == "__main__":
    build()
