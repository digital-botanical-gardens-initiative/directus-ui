"""Contract and failure-mode checks for the isolated iNaturalist exporter."""

import json
import tempfile
import unittest
from pathlib import Path
from urllib.error import HTTPError
from unittest.mock import patch

from scripts import build_inaturalist as inat


COLUMNS = inat.snapshot_columns()
TAXON_COLUMNS = inat.snapshot_taxon_columns()


def samples():
    return {"source": "https://emi-collection.unifr.ch/directus", "generated_at": "2026-11-13T00:00:00Z",
            "columns": COLUMNS, "taxon_columns": TAXON_COLUMNS,
            "rows": [[91, "dbgi_000037", None, None, None, None, None, 7, "accepted_exact"],
                     [92, "dbgi_000038", None, None, None, None, None, None, None]],
            "taxa": [[7, "COL-7", "Echeveria elegans", None, "species", None, "2026"]]}


def observation(obs_id=110560140, sample_id="dbgi_000037", community=206749, observer=206749, name="Echeveria elegans",
                photo="https://inaturalist-open-data.s3.amazonaws.com/photos/186526029/square.jpeg"):
    return {"id": obs_id, "emi_external_id": sample_id, "community_taxon_id": community,
            "taxon_id": observer, "taxon_name": name, "taxon_rank": "species", "photo_url": photo,
            "photos": repr([{"186526029": photo}]) if photo is not None else None,
            "uri": f"https://www.inaturalist.org/observations/{obs_id}", "private_curator_notes": "NEVER EXPORT"}


class InaturalistTests(unittest.TestCase):
    def test_community_taxon_is_not_observer_taxon_and_missing_is_unassessable(self):
        source = [observation(110560140, community=206749, observer=4, name="Different observer taxon"),
                  observation(110561024, sample_id="dbgi_000038", community=None, observer=99, name="Echeveria elegans", photo=None),
                  observation(110560141, community=5, observer=206749),
                  observation(110560142, community=6, observer=6),
                  observation(999, sample_id="ofvs_15466")]
        communities = {206749: {"name": "Echeveria elegans", "rank": "species", "is_active": True},
                       5: {"name": "Echeveria agavoides", "rank": "species", "is_active": True},
                       6: {"name": "Echeveria", "rank": "genus", "is_active": True}}
        photo = {110560140: {"photos": [{"id": 186526029, "attribution": "© Photographer", "license_code": "cc-by"}]}}
        rows, count = inat.prepare(source, samples(), communities, photo)
        self.assertEqual((len(rows), count), (4, 2))
        by_id = {row[2]: row for row in rows}
        self.assertEqual(by_id[110560140][3:9], [4, "Different observer taxon", "species", 206749, "Echeveria elegans", "species"])
        self.assertEqual(by_id[110560140][12], "agreement")
        self.assertEqual(by_id[110560140][14][0][1:], ["© Photographer", "cc-by"])
        self.assertEqual(by_id[110560141][12], "potential disagreement")
        self.assertEqual(by_id[110560142][12], "unassessable")
        self.assertIn("ranks", by_id[110560142][13])
        self.assertEqual(by_id[110561024][12], "unassessable")
        self.assertIn("No iNaturalist community", by_id[110561024][13])
        self.assertEqual(by_id[110561024][10], None)
        self.assertNotIn("private_curator_notes", json.dumps(rows))
        self.assertNotIn("ofvs_15466", json.dumps(rows))

    def test_unresolved_and_nonaccepted_taxa_cannot_be_called_disagreements(self):
        col = samples()["taxa"][0]
        for community_id, community, expected in [
            (None, None, "No iNaturalist community"),
            (5, None, "could not be resolved"),
            (5, {"name": "Wrong", "rank": "species", "is_active": False}, "not an active"),
            (5, {"name": "Wrong", "rank": "complex", "is_active": True}, "comparable rank"),
            (5, {"name": "Wrong", "rank": "genus", "is_active": True}, "Different taxonomic ranks"),
        ]:
            status, reason = inat.compare(community_id, community, col)
            self.assertEqual(status, "unassessable")
            self.assertIn(expected, reason)
        self.assertEqual(inat.compare(5, {"name": " EChEVERIA ELEGANS ", "rank": "Species", "is_active": True}, col)[0], "agreement")
        self.assertEqual(inat.compare(5, {"name": "Echeveria agavoides", "rank": "species", "is_active": True}, None)[0], "unassessable")

    def test_rejects_bad_links_photo_hosts_ids_and_duplicates(self):
        bad_photos = ["javascript:alert(1)", "http://inaturalist-open-data.s3.amazonaws.com/photos/186526029/square.jpeg",
                      "https://inaturalist-open-data.s3.amazonaws.com.evil.test/photos/186526029/square.jpeg",
                      "https://static.inaturalist.org/photos/0/square.jpg", "https://static.inaturalist.org/photos/42/square.jpg?tracking=1"]
        for url in bad_photos:
            self.assertIsNone(inat.photo_id(url))
            with self.assertRaisesRegex(ValueError, "Invalid or duplicate photo"):
                inat.prepare([observation(photo=url)], samples(), {}, {})
        for url in ["javascript:alert(1)", "https://www.inaturalist.org.evil.test/observations/110560140",
                    "https://www.inaturalist.org/observations/110560141"]:
            with self.assertRaisesRegex(ValueError, "Invalid iNaturalist observation URL"):
                inat.prepare([{**observation(), "uri": url}], samples(), {}, {})
        with self.assertRaisesRegex(ValueError, "Duplicate Curation_Data observation ID"):
            inat.prepare([observation(), observation()], samples(), {}, {})
        with self.assertRaisesRegex(ValueError, "Invalid observer taxon ID"):
            inat.prepare([{**observation(), "taxon_id": True}], samples(), {}, {})
        with self.assertRaisesRegex(ValueError, "Ambiguous sample ID"):
            inat.prepare([], {**samples(), "rows": samples()["rows"] * 2}, {}, {})

    def test_photo_credit_must_match_directus_photo_id(self):
        row = observation()
        metadata = {row["id"]: {"photos": [{"id": 2, "attribution": "Wrong photographer", "license_code": "cc-by"}]}}
        exported, _ = inat.prepare([row], samples(), {}, metadata)
        self.assertEqual(exported[0][14], [[row["photo_url"], None, None]])

    def test_all_directus_photos_keep_order_and_only_matching_api_credits(self):
        first = "https://inaturalist-open-data.s3.amazonaws.com/photos/186526029/square.jpeg"
        second = "https://static.inaturalist.org/photos/186526034/square.jpg"
        source = observation()
        source["photos"] = repr([{"186526029": first}, {"186526034": second}])
        metadata = {source["id"]: {"photos": [
            {"id": 186526034, "attribution": "© Second creator", "license_code": "cc-by"},
            {"id": 3, "attribution": "Unrelated", "license_code": "cc0"}]}}
        exported, _ = inat.prepare([source], samples(), {}, metadata)
        self.assertEqual(exported[0][14], [[first, None, None], [second, "© Second creator", "cc-by"]])
        self.assertEqual(inat.directus_photos(None, None, 7), [])
        for serialized, first_photo, expected in [
            ("__import__('os').system('false')", first, "Malformed"),
            (repr([{"186526029": first}, {"186526029": first}]), first, "duplicate"),
            (repr([{"186526034": second}]), first, "does not match"),
            (repr([{"186526035": second}]), second, "Invalid"),
            ("{'186526029': 'bad'}", first, "Malformed"),
        ]:
            with self.assertRaisesRegex(ValueError, expected):
                inat.directus_photos(serialized, first_photo, 7)

    def test_external_api_throttling_returns_partial_lookups_without_source_loss(self):
        def lookup(path):
            if path.startswith("/taxa/10,"):
                return [{"id": 10, "name": "Echeveria elegans"}]
            raise HTTPError(path, 429, "normal_throttling", {}, None)

        with patch.object(inat, "get_api", side_effect=lookup):
            records = inat.fetch_api_records("taxa", [10] + list(range(11, 36)))
        self.assertEqual(records[10]["name"], "Echeveria elegans")
        self.assertEqual(len(records), 1)

    def test_atomic_export_retains_directus_rows_when_lookups_disappear(self):
        source = [observation(), observation(110561024, sample_id="dbgi_000038", community=None, photo=None)]
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "inaturalist.json"
            sample_path = Path(directory) / "samples.json"
            sample_path.write_text(json.dumps(samples()), encoding="utf-8")
            destination.write_text("prior snapshot", encoding="utf-8")
            with patch.object(inat, "SAMPLES", sample_path), patch.object(inat, "OUT", destination), \
                 patch.object(inat, "fetch_public", return_value=[{**source[0], "photo_url": "javascript:alert(1)"}]), \
                 patch.object(inat, "fetch_api_records", side_effect=[{}, {}]):
                with self.assertRaisesRegex(ValueError, "photo_url does not match"):
                    inat.build()
                self.assertEqual(destination.read_text(), "prior snapshot")
            with patch.object(inat, "SAMPLES", sample_path), patch.object(inat, "OUT", destination), \
                 patch.object(inat, "fetch_public", return_value=source), \
                 patch.object(inat, "fetch_api_records", side_effect=[{}, {}]):
                inat.build()
            exported = json.loads(destination.read_text(encoding="utf-8"))
            self.assertEqual(exported["rows"][0][12], "unassessable")
            self.assertEqual(exported["rows"][0][14], [[source[0]["photo_url"], None, None]])
            meta = {110560140: {"photos": [{"id": 186526029, "attribution": "CC0 credit", "license_code": "cc0"}]}}
            with patch.object(inat, "SAMPLES", sample_path), patch.object(inat, "OUT", destination), \
                 patch.object(inat, "fetch_public", return_value=source), \
                 patch.object(inat, "fetch_api_records", side_effect=[{206749: {"name": "Echeveria elegans", "rank": "species", "is_active": True}}, meta]):
                inat.build()
            exported = json.loads(destination.read_text(encoding="utf-8"))
            self.assertEqual((exported["source_count"], exported["linked_samples"], len(exported["rows"])), (2, 2, 2))
            self.assertEqual(exported["columns"], inat.COLUMNS)
            self.assertEqual(exported["rows"][0][14][0][1:], ["CC0 credit", "cc0"])
            self.assertEqual(exported["rows"][1][12], "unassessable")
            self.assertEqual(exported["provenance"]["join"], "Curation_Data.emi_external_id = Field_Data.sample_id")
            self.assertNotIn("prior snapshot", destination.read_text())


if __name__ == "__main__":
    unittest.main()
