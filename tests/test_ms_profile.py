"""Directus-only recorded MS-file export and its fail-closed lineage checks."""

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from build_ms_profile import FIELDS, SAMPLE_COLUMNS, build, profile_snapshot, published_samples  # noqa: E402


class MSProfileTests(unittest.TestCase):
    def setUp(self):
        self.published = {1: ("field_1", 101), 2: ("field_2", 202)}
        self.records = {name: [] for name in FIELDS}
        self.records["Field_Data"] = [
            {"id": 1, "sample_id": "field_1", "taxon_ref": 101},
            {"id": 2, "sample_id": "field_2", "taxon_ref": 202},
            {"id": 3, "sample_id": "field_3", "taxon_ref": 303},
        ]
        self.records["Containers"] = [
            {"id": 11, "container_id": "field_1"},
            {"id": 12, "container_id": "field_2"},
            {"id": 13, "container_id": "field_3"},
            {"id": 20, "container_id": "dried_1"},
            {"id": 21, "container_id": "extracted_1"},
            {"id": 22, "container_id": "aliquot_1"},
            {"id": 99, "container_id": "unlinked"},
        ]
        self.records["Dried_Samples_Data"] = [
            {"id": 1, "field_data": 1, "sample_container": 20},
        ]
        self.records["Extraction_Data"] = [
            {"id": 1, "parent_sample_container": 20, "sample_container": 21},
        ]
        self.records["Aliquoting_Data"] = [
            {"id": 1, "parent_sample_container": 21, "sample_container": 22},
        ]
        self.records["MS_Data"] = [
            {"id": 41, "status": "OK", "uuid_ms_file": "uuid-1", "instrument_used": 1, "parent_sample_container": 22, "filename": "run_001"},
            {"id": 42, "status": "published", "uuid_ms_file": "uuid-2", "instrument_used": 2, "parent_sample_container": 12, "filename": "run_002.mzML"},
            {"id": 43, "status": "OK", "uuid_ms_file": "uuid-3", "instrument_used": 1, "parent_sample_container": 13},
            {"id": 44, "status": "OK", "uuid_ms_file": "uuid-4", "instrument_used": 1, "parent_sample_container": 99},
            {"id": 45, "status": "OK", "uuid_ms_file": None, "instrument_used": 1, "parent_sample_container": 11},
            {"id": 46, "status": "NOTOK", "uuid_ms_file": "uuid-6", "instrument_used": 1, "parent_sample_container": 11},
        ]
        self.records["Instruments"] = [
            {"id": 1, "instrument_id": "inst_1", "instrument_model": {"id": 11, "instrument_model": "QExactive HFX"}},
            {"id": 2, "instrument_id": "inst_2", "instrument_model": {"id": 12, "instrument_model": "Orbitrap"}},
        ]

    def snapshot(self, records=None, published=None):
        return profile_snapshot(self.records if records is None else records,
                                self.published if published is None else published,
                                "https://example.test/directus", "2026-01-01T00:00:00+00:00")

    def test_two_species_distinct_instruments_and_truthful_exclusions(self):
        snapshot = self.snapshot()
        self.assertEqual(snapshot["profiles"], [[41, 1, 1, "OK", "run_001"], [42, 2, 2, "published", "run_002.mzML"]])
        self.assertEqual(snapshot["instruments"], [[1, "inst_1", "QExactive HFX"], [2, "inst_2", "Orbitrap"]])
        self.assertEqual(snapshot["total_ms_records"], 6)
        self.assertEqual(snapshot["gnps_filenames_unavailable"], 0)
        for key in ("excluded_unlinked_ms", "excluded_outside_snapshot_ms",
                    "excluded_without_file_ms", "excluded_other_status_ms"):
            self.assertEqual(snapshot[key], 1, key)
        for uuid in ("uuid-1", "uuid-2", "uuid-3"):
            self.assertNotIn(uuid, json.dumps(snapshot))

    def test_direct_dried_and_extracted_fk_paths(self):
        rows = copy.deepcopy(self.records)
        rows["MS_Data"].extend([
            {"id": 47, "status": "OK", "uuid_ms_file": "uuid-7", "instrument_used": 2, "parent_sample_container": 20},
            {"id": 48, "status": "OK", "uuid_ms_file": "uuid-8", "instrument_used": 2, "parent_sample_container": 21, "filename": "../escape?foo"},
        ])
        snapshot = self.snapshot(rows)
        self.assertEqual(snapshot["profiles"][-2:], [[47, 1, 2, "OK", None], [48, 1, 2, "OK", None]])
        self.assertEqual(snapshot["gnps_filenames_unavailable"], 2)

    def test_conflicting_parent_and_missing_container_abort(self):
        rows = copy.deepcopy(self.records)
        rows["Dried_Samples_Data"][0]["field_data"] = 2
        rows["Dried_Samples_Data"][0]["sample_container"] = 11
        with self.assertRaisesRegex(ValueError, "Conflicting"):
            self.snapshot(rows)
        rows = copy.deepcopy(self.records)
        rows["MS_Data"][0]["parent_sample_container"] = 999
        with self.assertRaisesRegex(ValueError, "missing container"):
            self.snapshot(rows)
        rows = copy.deepcopy(self.records)
        rows["Extraction_Data"][0]["sample_container"] = 12
        with self.assertRaisesRegex(ValueError, "Conflicting"):
            self.snapshot(rows)

    def test_stale_taxon_or_sample_id_and_missing_instrument_abort(self):
        rows = copy.deepcopy(self.records)
        rows["Field_Data"][0]["taxon_ref"] = 202
        with self.assertRaisesRegex(ValueError, "taxon_ref"):
            self.snapshot(rows)
        rows = copy.deepcopy(self.records)
        rows["Field_Data"][0]["sample_id"] = "reassigned"
        with self.assertRaisesRegex(ValueError, "sample_id"):
            self.snapshot(rows)
        rows = copy.deepcopy(self.records)
        rows["MS_Data"][0]["instrument_used"] = 999
        with self.assertRaisesRegex(ValueError, "missing instrument"):
            self.snapshot(rows)
        rows = copy.deepcopy(self.records)
        rows["MS_Data"][-1]["instrument_used"] = None  # Excluded statuses still need consistent FKs.
        with self.assertRaisesRegex(ValueError, "missing instrument"):
            self.snapshot(rows)
        rows = copy.deepcopy(self.records)
        rows["Instruments"][0]["instrument_model"] = None
        with self.assertRaisesRegex(ValueError, "model relation"):
            self.snapshot(rows)

    def test_invalid_published_sample_fails_before_fetch_and_export_is_atomic(self):
        with tempfile.TemporaryDirectory() as directory:
            samples = Path(directory) / "samples.json"
            output = Path(directory) / "profile.json"
            output.write_text("unchanged", encoding="utf-8")
            samples.write_text(json.dumps({"columns": SAMPLE_COLUMNS, "rows": [[1, "field_1"]]}), encoding="utf-8")
            with patch("build_ms_profile.fetch_all", side_effect=AssertionError("unexpected fetch")):
                with self.assertRaisesRegex(ValueError, "published sample row"):
                    build(output=output, samples=samples)
            self.assertEqual(output.read_text(encoding="utf-8"), "unchanged")
            samples.write_text(json.dumps({"columns": SAMPLE_COLUMNS, "rows": [
                [1, "field_1", None, None, None, None, None, 101, None, "Leaf"],
                [2, "field_2", None, None, None, None, None, 202, None, None],
            ]}), encoding="utf-8")
            self.assertEqual(published_samples(samples), self.published)
            rows = copy.deepcopy(self.records)
            rows["MS_Data"][0]["instrument_used"] = 999
            with patch("build_ms_profile.fetch_all", side_effect=lambda name, fields, base, token: rows[name]):
                with self.assertRaisesRegex(ValueError, "missing instrument"):
                    build(output=output, samples=samples)
            self.assertEqual(output.read_text(encoding="utf-8"), "unchanged")
            self.assertFalse(output.with_suffix(".json.tmp").exists())

    def test_fetches_only_approved_fields_and_exports_complete_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            samples = Path(directory) / "samples.json"
            output = Path(directory) / "profile.json"
            samples.write_text(json.dumps({"columns": SAMPLE_COLUMNS, "rows": [
                [key, value[0], None, None, None, None, None, value[1], None, "Flower"]
                for key, value in self.published.items()]}), encoding="utf-8")
            calls = []
            def fake_get_data(collection, params, base, token):
                calls.append((collection, params))
                if "aggregate[count]" in params:
                    return [{"count": {"id": str(len(self.records[collection]))}}]
                self.assertEqual(params["fields"], FIELDS[collection])
                self.assertEqual(params["sort"], "id")
                return self.records[collection][params["offset"]:params["offset"] + params["limit"]]
            with patch("build_snapshot.get_data", side_effect=fake_get_data):
                build(output=output, samples=samples)
            self.assertEqual(len(calls), 3 * len(FIELDS))
            self.assertEqual({name for name, _ in calls}, set(FIELDS))
            self.assertEqual(json.loads(output.read_text(encoding="utf-8"))["profiles"],
                             [[41, 1, 1, "OK", "run_001"], [42, 2, 2, "published", "run_002.mzML"]])


if __name__ == "__main__":
    unittest.main()
