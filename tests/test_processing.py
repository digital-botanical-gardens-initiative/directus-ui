"""Published processing links are explicit Directus relations, not inferred QC or files."""

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from build_processing import COLUMNS, FIELDS, build, processing_snapshot  # noqa: E402
from build_ms_profile import SAMPLE_COLUMNS  # noqa: E402


class ProcessingTests(unittest.TestCase):
    def setUp(self):
        self.published = {1: ("field_1", 101), 2: ("field_2", 202)}
        self.records = {name: [] for name in FIELDS}
        self.records["Field_Data"] = [
            {"id": 1, "sample_id": "field_1", "taxon_ref": 101},
            {"id": 2, "sample_id": "field_2", "taxon_ref": 202},
            {"id": 3, "sample_id": "field_3", "taxon_ref": 303},
        ]
        self.records["Containers"] = [
            {"id": 11, "container_id": "field_1", "parent_container": None},
            {"id": 12, "container_id": "field_2", "parent_container": None},
            {"id": 13, "container_id": "field_3", "parent_container": None},
            {"id": 20, "container_id": "dried_1", "parent_container": 11},
            {"id": 21, "container_id": "extract_1", "parent_container": 20},
            {"id": 22, "container_id": "aliquot_1", "parent_container": 21},
            {"id": 23, "container_id": "extract_branch_1", "parent_container": 20},
            {"id": 24, "container_id": "aliquot_branch_1", "parent_container": 23},
            {"id": 30, "container_id": "dried_2", "parent_container": 12},
            {"id": 31, "container_id": "extract_2", "parent_container": 30},
            {"id": 40, "container_id": "outside", "parent_container": 13},
            {"id": 90, "container_id": "unlinked", "parent_container": None},
            {"id": 91, "container_id": "unlinked_child", "parent_container": 90},
        ]
        self.records["Dried_Samples_Data"] = [
            {"id": 5, "field_data": 1, "sample_container": 20, "status": "drying"},
            {"id": 6, "field_data": 2, "sample_container": 30, "status": None},
            {"id": 7, "field_data": 3, "sample_container": 40, "status": "OK"},
            {"id": 8, "field_data": None, "sample_container": 90, "status": "pending"},
        ]
        self.records["Extraction_Data"] = [
            {"id": 13, "parent_sample_container": 20, "sample_container": 21, "status": "NOTOK"},
            {"id": 11, "parent_sample_container": 20, "sample_container": 23, "status": None},
            {"id": 14, "parent_sample_container": 30, "sample_container": 31, "status": "OK"},
            {"id": 15, "parent_sample_container": 90, "sample_container": 91, "status": None},
        ]
        self.records["Aliquoting_Data"] = [
            {"id": 3, "parent_sample_container": 21, "sample_container": 22, "status": "queued"},
            {"id": 4, "parent_sample_container": 23, "sample_container": 24, "status": None},
        ]
        self.records["MS_Data"] = [
            {"id": 3, "parent_sample_container": 22, "status": "NOTOK"},
            {"id": 1, "parent_sample_container": 12, "status": None},
            {"id": 2, "parent_sample_container": 24, "status": "OK"},
            {"id": 4, "parent_sample_container": 13, "status": "OK"},
            {"id": 5, "parent_sample_container": 90, "status": "pending"},
        ]

    def snapshot(self, records=None, published=None):
        return processing_snapshot(self.records if records is None else records,
                                   self.published if published is None else published,
                                   "https://example.test/directus", "2026-01-01T00:00:00+00:00")

    def test_branches_two_samples_direct_ms_and_non_ok_status(self):
        snapshot = self.snapshot()
        self.assertEqual(snapshot["source"], "https://example.test/directus/items/")
        self.assertEqual(snapshot["columns"], COLUMNS)
        self.assertEqual(snapshot["records"], [
            ["dried", 5, 1, 20, "dried_1", 11, "drying"],
            ["dried", 6, 2, 30, "dried_2", 12, None],
            ["extract", 11, 1, 23, "extract_branch_1", 20, None],
            ["extract", 13, 1, 21, "extract_1", 20, "NOTOK"],
            ["extract", 14, 2, 31, "extract_2", 30, "OK"],
            ["aliquot", 3, 1, 22, "aliquot_1", 21, "queued"],
            ["aliquot", 4, 1, 24, "aliquot_branch_1", 23, None],
            ["ms", 1, 2, None, None, 12, None],
            ["ms", 2, 1, None, None, 24, "OK"],
            ["ms", 3, 1, None, None, 22, "NOTOK"],
        ])
        for kind, total, unlinked, outside in (("dried", 4, 1, 1), ("extract", 4, 1, 0),
                                                ("aliquot", 2, 0, 0), ("ms", 5, 1, 1)):
            self.assertEqual(snapshot[f"total_{kind}_records"], total)
            self.assertEqual(snapshot[f"excluded_unlinked_{kind}"], unlinked)
            self.assertEqual(snapshot[f"excluded_outside_snapshot_{kind}"], outside)
        self.assertNotIn("uuid_ms_file", json.dumps(snapshot))

    def test_missing_containers_conflicting_ancestry_and_missing_field_abort(self):
        rows = copy.deepcopy(self.records)
        rows["MS_Data"][0]["parent_sample_container"] = 999
        with self.assertRaisesRegex(ValueError, "missing parent_sample_container container"):
            self.snapshot(rows)
        rows = copy.deepcopy(self.records)
        rows["Extraction_Data"][0]["parent_sample_container"] = 12
        with self.assertRaisesRegex(ValueError, "Conflicting .* ancestry"):
            self.snapshot(rows)
        rows = copy.deepcopy(self.records)
        rows["Containers"][4]["parent_container"] = 12
        with self.assertRaisesRegex(ValueError, "Conflicting Containers ancestry"):
            self.snapshot(rows)
        rows = copy.deepcopy(self.records)
        rows["Dried_Samples_Data"][0]["field_data"] = 999
        with self.assertRaisesRegex(ValueError, "missing Field_Data"):
            self.snapshot(rows)

    def test_dried_parent_only_from_unique_sample_container(self):
        rows = copy.deepcopy(self.records)
        rows["Containers"].append({"id": 111, "container_id": "field_1", "parent_container": None})
        snapshot = self.snapshot(rows)
        self.assertIsNone(snapshot["records"][0][5])
        self.assertEqual(snapshot["records"][2][5], 20)
        self.assertFalse(any(row[0] == "ms" and row[1] == 5 for row in snapshot["records"]))

    def test_container_parent_alone_does_not_create_processing_lineage(self):
        rows = copy.deepcopy(self.records)
        rows["Containers"][-1]["parent_container"] = 11
        rows["MS_Data"].append({"id": 6, "parent_sample_container": 91, "status": "OK"})
        snapshot = self.snapshot(rows)
        self.assertEqual(snapshot["excluded_unlinked_ms"], 2)
        self.assertFalse(any(row[0] == "ms" and row[1] == 6 for row in snapshot["records"]))

    def test_stale_published_identity_and_absent_field_abort(self):
        rows = copy.deepcopy(self.records)
        rows["Field_Data"][0]["taxon_ref"] = 999
        with self.assertRaisesRegex(ValueError, "differs from published"):
            self.snapshot(rows)
        rows = copy.deepcopy(self.records)
        rows["Field_Data"].pop(0)
        with self.assertRaisesRegex(ValueError, "missing from Directus"):
            self.snapshot(rows)

    def test_fetches_approved_fields_and_writes_atomically(self):
        with tempfile.TemporaryDirectory() as directory:
            samples = Path(directory) / "samples.json"
            output = Path(directory) / "processing.json"
            samples.write_text(json.dumps({"columns": SAMPLE_COLUMNS, "rows": [
                [key, value[0], None, None, None, None, None, value[1], None, None]
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
            exported = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(exported["records"], self.snapshot()["records"])
            self.assertFalse(output.with_suffix(".json.tmp").exists())
            output.write_text("unchanged", encoding="utf-8")
            stale = copy.deepcopy(self.records)
            stale["Field_Data"][0]["sample_id"] = "changed"
            with patch("build_processing.fetch_all", side_effect=lambda name, fields, base, token: stale[name]):
                with self.assertRaisesRegex(ValueError, "differs from published"):
                    build(output=output, samples=samples)
            self.assertEqual(output.read_text(encoding="utf-8"), "unchanged")
            self.assertFalse(output.with_suffix(".json.tmp").exists())


if __name__ == "__main__":
    unittest.main()
