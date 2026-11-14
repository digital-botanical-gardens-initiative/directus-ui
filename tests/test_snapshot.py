"""Behavior and integrity checks for the published taxonomy snapshot."""

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import build_snapshot as snapshot


class SnapshotTests(unittest.TestCase):
    def test_field_and_resolved_taxon_are_distinct_and_private_fields_are_excluded(self):
        row = {"id": 42, "sample_id": "dbgi_42", "qfield_project": "jbuf",
               "taxon_name_unified": "  Original label  ", "taxon_name": "Different name",
               "taxon_ref": 3, "taxon_resolution_status": "synonym", "observation_subject": "  Leaf ",
               "geometry": {"type": "Point", "coordinates": [7.15, 46.79]},
               "latitude": 7.15, "longitude": 46.79,
               "collector_fullname": "Not public", "collector_orcid": "Not public"}
        self.assertEqual(snapshot.public_row(row),
                         [42, "dbgi_42", "jbuf", "Original label", 7.15, 46.79, None, 3, "synonym", "Leaf"])
        row["geometry"]["coordinates"] = [200, 95]
        row["taxon_name_unified"] = ""
        row["taxon_ref"] = None
        row["observation_subject"] = "  "
        self.assertEqual(snapshot.public_row(row),
                         [42, "dbgi_42", "jbuf", "Different name", None, None, None, None, "synonym", None])
        row["sample_id"] = None
        self.assertIsNone(snapshot.public_row(row))
        row["sample_id"] = "dbgi_42"
        row["observation_subject"] = 17
        with self.assertRaisesRegex(ValueError, "Invalid observation_subject"):
            snapshot.public_row(row)

    def test_export_keeps_taxa_ancestry_and_unresolved_samples(self):
        fields = [{"id": 1, "sample_id": "a", "taxon_ref": 3, "taxon_col_id": "COL-S",
                   "geometry": None, "taxon_name_unified": "Old synonym", "observation_subject": "Flower"},
                  {"id": 2, "sample_id": None, "taxon_ref": None},
                  {"id": 3, "sample_id": "c", "taxon_ref": None, "sample_name": "Unmatched"}]
        taxa = [{"id": 1, "col_id": "COL-F", "scientific_name": "Rubiaceae", "rank": "family", "parent_ref": None},
                {"id": 2, "col_id": "COL-G", "scientific_name": "Coffea", "rank": "genus", "parent_ref": 1},
                {"id": 3, "col_id": "COL-S", "scientific_name": "Coffea arabica", "rank": "species", "parent_ref": 2}]

        def fetch(collection, params, base, token):
            source = fields if collection == "Field_Data" else taxa
            if "aggregate[count]" in params:
                return [{"count": {"id": str(len(source))}}]
            return source[params["offset"]:params["offset"] + params["limit"]]

        with tempfile.TemporaryDirectory() as directory, \
                patch.object(snapshot, "OUT", Path(directory) / "samples.json"), \
                patch.object(snapshot, "PAGE_SIZE", 2), \
                patch.object(snapshot, "credentials", return_value=("https://example.org/directus", "secret")), \
                patch.object(snapshot, "get_data", side_effect=fetch):
            snapshot.build()
            data = json.loads(snapshot.OUT.read_text())
            self.assertEqual(data["total_rows"], 3)
            self.assertEqual([row[1] for row in data["rows"]], ["a", "c"])
            self.assertEqual(data["rows"][0][3:8], ["Old synonym", None, None, None, 3])
            self.assertEqual(data["columns"][-1], "observation_subject")
            self.assertEqual([row[9] for row in data["rows"]], ["Flower", None])
            self.assertEqual(data["rows"][1][7], None)
            self.assertEqual([taxon[5] for taxon in data["taxa"]], [None, 1, 2])

    def test_broken_taxonomy_or_mismatched_col_id_blocks_export(self):
        family = [1, "COL-F", "Rubiaceae", None, "family", None, "release"]
        species = [2, "COL-S", "Coffea arabica", None, "species", 1, "release"]
        field = {"id": 7, "taxon_ref": 2, "taxon_col_id": "COL-S"}
        snapshot.validate_links([field], [family, species])
        with self.assertRaisesRegex(ValueError, "Missing Taxa parent"):
            snapshot.validate_links([field], [family, species[:5] + [99] + species[6:]])
        with self.assertRaisesRegex(ValueError, "ancestry cycle"):
            snapshot.validate_links([field], [family[:5] + [2] + family[6:], species])
        with self.assertRaisesRegex(ValueError, "mismatched CoL id"):
            snapshot.validate_links([{**field, "taxon_col_id": "WRONG"}], [family, species])
        with self.assertRaisesRegex(ValueError, "missing Taxa"):
            snapshot.validate_links([{**field, "taxon_ref": 99}], [family, species])

    def test_changed_source_count_does_not_overwrite_existing_snapshot(self):
        counts = iter([2, 3])

        def fetch(collection, params, base, token):
            if "aggregate[count]" in params:
                return [{"count": {"id": str(next(counts))}}]
            return [{"id": 1, "sample_id": "a"}, {"id": 2, "sample_id": "b"}]

        with tempfile.TemporaryDirectory() as directory, \
                patch.object(snapshot, "OUT", Path(directory) / "samples.json"), \
                patch.object(snapshot, "credentials", return_value=("https://example.org/directus", "secret")), \
                patch.object(snapshot, "get_data", side_effect=fetch):
            snapshot.OUT.write_text("prior snapshot")
            with self.assertRaisesRegex(ValueError, "count changed"):
                snapshot.build()
            self.assertEqual(snapshot.OUT.read_text(), "prior snapshot")

    def test_taxonomy_refresh_requires_credentials(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError, "Taxa is not publicly readable"):
                snapshot.credentials()

    def test_read_only_token_allows_refresh_without_login(self):
        with patch.dict(os.environ, {"DIRECTUS_TOKEN": "read-only", "DIRECTUS_INSTANCE": "https://example.org/directus"}, clear=True):
            self.assertEqual(snapshot.credentials(), ("https://example.org/directus", "read-only"))
        with patch.dict(os.environ, {"DIRECTUS_TOKEN": "read-only", "DIRECTUS_INSTANCE": "https://user:password@example.org/directus"}, clear=True):
            with self.assertRaisesRegex(ValueError, "credential-free HTTPS"):
                snapshot.credentials()


if __name__ == "__main__":
    unittest.main()
