"""Collector exports are keyed to published Field_Data and canonical People IDs."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import build_collectors as collectors

BASE = "https://example.org/directus"


def sample_snapshot():
    return {"source": BASE, "generated_at": "2026-11-13T12:00:00+00:00",
            "rows": [[10, "sample-10"], [11, "sample-11"], [12, "sample-12"],
                     [13, "sample-13"], [14, "sample-14"]]}


class CollectorsExportTests(unittest.TestCase):
    def test_distinct_people_same_name_and_aliases_do_not_split_identities(self):
        fields = [
            {"id": 14, "sample_id": "sample-14", "collector_ref": 2, "collector_fullname": "Alias B"},
            {"id": 12, "sample_id": "sample-12", "collector_ref": None, "collector_fullname": "Unlinked Name"},
            {"id": 11, "sample_id": "sample-11", "collector_ref": 1, "collector_fullname": "Alias A"},
            {"id": 13, "sample_id": "sample-13", "collector_ref": 2, "collector_fullname": "Different alias"},
            {"id": 10, "sample_id": "sample-10 ", "collector_ref": 1, "collector_fullname": "Other spelling"},
            {"id": 99, "sample_id": "outside snapshot", "collector_ref": 3, "collector_fullname": "Private"},
        ]
        people = [{"id": 1, "full_name": "Same Person", "email": "secret@example.org"},
                  {"id": 2, "full_name": "Same Person", "orcid": "secret"},
                  {"id": 3, "full_name": "Private"}]
        result = collectors.collect(sample_snapshot(), fields, people, BASE)
        self.assertEqual(result["total_field_rows"], 6)
        self.assertEqual(result["unlinked_named_samples"], 1)
        self.assertEqual(result["sample_snapshot_generated_at"], sample_snapshot()["generated_at"])
        self.assertEqual(result["collectors"], [
            {"id": 1, "name": "Same Person", "field_ids": [10, 11]},
            {"id": 2, "name": "Same Person", "field_ids": [13, 14]},
        ])
        self.assertNotIn("secret", json.dumps(result))
        self.assertNotIn("Unlinked Name", json.dumps(result))

    def test_snapshot_mismatch_or_missing_published_row_aborts_without_writing(self):
        fields = [{"id": row[0], "sample_id": row[1], "collector_ref": None}
                  for row in sample_snapshot()["rows"]]
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(collectors, "SAMPLES", Path(directory) / "samples.json"), \
                patch.object(collectors, "OUT", Path(directory) / "collectors.json"), \
                patch.object(collectors.build_snapshot, "credentials", return_value=(BASE, "token")), \
                patch.object(collectors.build_snapshot, "fetch_all") as fetch:
            collectors.SAMPLES.write_text(json.dumps(sample_snapshot()))
            collectors.OUT.write_text("previous snapshot")
            fetch.side_effect = lambda collection, *_: fields if collection == "Field_Data" else []
            fields[0] = {**fields[0], "sample_id": "changed"}
            with self.assertRaisesRegex(ValueError, "sample_id mismatch"):
                collectors.build()
            self.assertEqual(collectors.OUT.read_text(), "previous snapshot")
            fields.pop(0)
            with self.assertRaisesRegex(ValueError, "missing from Directus"):
                collectors.build()
            self.assertEqual(collectors.OUT.read_text(), "previous snapshot")

    def test_invalid_references_names_and_duplicate_ids_fail_closed(self):
        snapshot = {"source": BASE, "generated_at": "now", "rows": [[1, "a"]]}
        field = {"id": 1, "sample_id": "a", "collector_ref": 7}
        with self.assertRaisesRegex(ValueError, "missing People"):
            collectors.collect(snapshot, [field], [], BASE)
        with self.assertRaisesRegex(ValueError, "no full_name"):
            collectors.collect(snapshot, [field], [{"id": 7, "full_name": "  "}], BASE)
        with self.assertRaisesRegex(ValueError, "Invalid collector_ref"):
            collectors.collect(snapshot, [{**field, "collector_ref": True}], [], BASE)
        with self.assertRaisesRegex(ValueError, "duplicate Field_Data id"):
            collectors.collect(snapshot, [field, field], [{"id": 7, "full_name": "Valid"}], BASE)
        with self.assertRaisesRegex(ValueError, "Duplicate published Field_Data id"):
            collectors.collect({**snapshot, "rows": [[1, "a"], [1, "a"]]}, [field], [], BASE)



if __name__ == "__main__":
    unittest.main()
