"""Complete refresh marker must never make an incomplete publish look current."""

import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from scripts import build_refresh_manifest as refresh


class RefreshManifestTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.data = self.root / "data"
        self.data.mkdir()
        self.sample_time = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
        self.later_time = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
        for name in refresh.SNAPSHOTS:
            snapshot = {"generated_at": self.sample_time if name == "samples" else self.later_time}
            if name == "collectors":
                snapshot["sample_snapshot_generated_at"] = self.sample_time
            if name == "inaturalist":
                snapshot["sample_generated_at"] = self.sample_time
            self.put(name, snapshot)

    def put(self, name, snapshot):
        (self.data / f"{name}.json").write_text(json.dumps(snapshot), encoding="utf-8")

    def change(self, name, key, value):
        path = self.data / f"{name}.json"
        value_from_file = json.loads(path.read_text(encoding="utf-8"))
        value_from_file[key] = value
        self.put(name, value_from_file)

    def test_marker_records_success_only_after_all_six_exports_match(self):
        marker = refresh.build(self.root)
        self.assertEqual(marker["sample_generated_at"], self.sample_time)
        self.assertEqual(set(marker["snapshots"]), set(refresh.SNAPSHOTS))
        self.assertGreaterEqual(datetime.fromisoformat(marker["completed_at"]),
                                datetime.fromisoformat(self.later_time))
        self.assertEqual(json.loads((self.data / "refresh.json").read_text()), marker)

    def test_stale_or_mismatched_exports_never_replace_last_valid_marker(self):
        original = refresh.build(self.root)
        previous = (self.data / "refresh.json").read_bytes()
        for name, field, value in (
            ("processing", "generated_at", (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()),
            ("collectors", "sample_snapshot_generated_at", "other-field-export"),
            ("inaturalist", "sample_generated_at", "other-field-export"),
            ("ms_profile", "generated_at", "not-a-date"),
        ):
            path = self.data / f"{name}.json"
            saved = path.read_text(encoding="utf-8")
            self.change(name, field, value)
            with self.assertRaises(ValueError):
                refresh.build(self.root)
            self.assertEqual((self.data / "refresh.json").read_bytes(), previous)
            path.write_text(saved, encoding="utf-8")
        self.assertTrue(original["completed_at"])

    def test_missing_export_cannot_publish_a_marker(self):
        (self.data / "garden_progress.json").unlink()
        with self.assertRaises(FileNotFoundError):
            refresh.build(self.root)
        self.assertFalse((self.data / "refresh.json").exists())


if __name__ == "__main__":
    unittest.main()
