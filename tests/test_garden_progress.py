"""Isolated tests for Directus-only garden processing lineage and aggregation."""

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from build_garden_progress import CATALOG, FIELDS, build, load_gardens, progress_snapshot  # noqa: E402


class GardenProgressTests(unittest.TestCase):
    def setUp(self):
        projects = ["jbuf", "jbc", "jbn", "jbn-new", "jbp", "jbp-new",
                    "kew-botanical-gardens", "bg-unifr", "outside"]
        self.rows = {name: [] for name in FIELDS}
        self.rows["Field_Data"] = [
            {"id": i, "sample_id": f"sample_{i}", "qfield_project": project}
            for i, project in enumerate(projects, 1)
        ]
        self.rows["Containers"] = [
            {"id": 100 + i, "container_id": f"sample_{i}", "parent_container": None}
            for i in range(1, 10)
        ] + [
            {"id": i, "container_id": f"container_{i}", "parent_container": None}
            for i in [201, 301, 302, 303, 401, 909, 910, 911, 912, 913]
        ]
        self.rows["Dried_Samples_Data"] = [
            {"id": 1, "status": "present", "field_data": 1, "sample_container": 201},
            {"id": 2, "status": "present", "field_data": None, "sample_container": 912},
        ]
        self.rows["Extraction_Data"] = [
            {"id": 1, "status": "OK", "parent_sample_container": 201, "sample_container": 301},
            {"id": 2, "status": "NOTOK", "parent_sample_container": 102, "sample_container": 302},
            {"id": 3, "status": "present", "parent_sample_container": 107, "sample_container": 303},
            {"id": 4, "status": "OK", "parent_sample_container": 909, "sample_container": 910},
        ]
        self.rows["Aliquoting_Data"] = [
            {"id": 1, "status": "OK", "parent_sample_container": 301, "sample_container": 401},
            {"id": 2, "status": "OK", "parent_sample_container": 911, "sample_container": 913},
        ]
        self.rows["MS_Data"] = [
            {"id": 1, "status": "published", "parent_sample_container": 401},
            {"id": 2, "status": "OK", "parent_sample_container": 401},
            {"id": 3, "status": "OK", "parent_sample_container": 104},
            {"id": 4, "status": "OK", "parent_sample_container": 911},
        ]

    def snapshot(self, rows=None):
        return progress_snapshot(self.rows if rows is None else rows,
                                 "https://example.test/directus", "2026-01-01T00:00:00+00:00")

    def test_real_fk_paths_and_aliases_not_filename_or_status_assumptions(self):
        result = self.snapshot()
        self.assertEqual(result["total_samples"], 8)
        self.assertEqual([row["id"] for row in result["gardens"]],
                         ["fribourg", "champex", "neuchatel", "prague", "kew"])
        self.assertEqual([row["samples"] for row in result["gardens"]], [2, 1, 2, 2, 1])
        self.assertEqual([(row["collected_only"], row["extraction_record_present"],
                           row["ms_record_present"]) for row in result["gardens"]],
                         [(1, 0, 1), (0, 1, 0), (1, 0, 1), (2, 0, 0), (0, 1, 0)])
        self.assertEqual(result["gardens"][0]["projects"], ["jbuf", "bg-unifr"])
        self.assertEqual(result["gardens"][2]["projects"], ["jbn", "jbn-new"])
        self.assertEqual(result["gardens"][3]["projects"], ["jbp", "jbp-new"])
        self.assertEqual(result["record_statuses"]["Extraction_Data"],
                         {"NOTOK": 1, "OK": 1, "present": 1})
        self.assertEqual(result["record_statuses"]["MS_Data"], {"OK": 2, "published": 1})
        self.assertEqual(result["ms_without_extraction_samples"], 1)
        self.assertEqual(result["unlinked_processing_records"],
                         {"Dried_Samples_Data": 1, "Extraction_Data": 1,
                          "Aliquoting_Data": 1, "MS_Data": 1})
        for sample_id in (f"sample_{i}" for i in range(1, 10)):
            self.assertNotIn(sample_id, json.dumps(result))

    def test_unlinked_extraction_cannot_launder_ms_record_into_garden(self):
        rows = copy.deepcopy(self.rows)
        rows["MS_Data"].append({"id": 5, "status": "OK", "parent_sample_container": 910})
        result = self.snapshot(rows)
        self.assertEqual(result["unlinked_processing_records"]["MS_Data"], 2)
        self.assertEqual(result["gardens"][4]["ms_record_present"], 0)

    def test_conflicting_explicit_lineage_and_duplicate_samples_fail_closed(self):
        rows = copy.deepcopy(self.rows)
        rows["Dried_Samples_Data"][0]["sample_container"] = 102
        with self.assertRaisesRegex(ValueError, "Conflicting"):
            self.snapshot(rows)
        rows = copy.deepcopy(self.rows)
        rows["Field_Data"][1]["sample_id"] = "sample_1"
        with self.assertRaisesRegex(ValueError, "Duplicate garden"):
            self.snapshot(rows)

    def test_missing_container_fails_closed(self):
        rows = copy.deepcopy(self.rows)
        rows["MS_Data"][0]["parent_sample_container"] = 999
        with self.assertRaisesRegex(ValueError, "missing container"):
            self.snapshot(rows)

    def test_catalog_rejects_missing_and_duplicate_aliases_before_export(self):
        catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "gardens.json"
            output = Path(directory) / "snapshot.json"
            output.write_text("untouched", encoding="utf-8")
            for change, message in [
                (lambda gardens: gardens[0].pop("aliases"), "requires id, name, aliases, url"),
                (lambda gardens: gardens[0].update(aliases=[]), "Missing project aliases"),
                (lambda gardens: gardens[1]["aliases"].append("jbuf"), "Duplicate project alias"),
            ]:
                broken = copy.deepcopy(catalog)
                change(broken["gardens"])
                path.write_text(json.dumps(broken), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, message):
                    load_gardens(path)
                with patch("build_snapshot.get_data", side_effect=AssertionError("unexpected fetch")):
                    with self.assertRaisesRegex(ValueError, message):
                        build(output=output, catalog=path)
                self.assertEqual(output.read_text(encoding="utf-8"), "untouched")

    def test_export_fetches_all_six_collections_without_private_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "garden.json"
            calls = []
            def fake_get_data(collection, params, base, token):
                self.assertEqual(base, "https://emi-collection.unifr.ch/directus")
                calls.append((collection, params))
                if "aggregate[count]" in params:
                    return [{"count": {"id": str(len(self.rows[collection]))}}]
                self.assertEqual(params["fields"], FIELDS[collection])
                self.assertEqual(params["sort"], "id")
                return self.rows[collection][params["offset"]:params["offset"] + params["limit"]]
            with patch("build_snapshot.get_data", side_effect=fake_get_data):
                build(output=output)
            self.assertEqual({collection for collection, _ in calls}, set(FIELDS))
            self.assertEqual(len(calls), 3 * len(FIELDS))
            exported = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(exported["total_samples"], 8)
            self.assertIn("generated_at", exported)
            self.assertEqual(exported["source"], "https://emi-collection.unifr.ch/directus/items/")


if __name__ == "__main__":
    unittest.main()
