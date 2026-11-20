"""Scope all published relations without changing the unrestricted EMI artifact."""

import copy
import json
import tempfile
import unittest
from pathlib import Path

from scripts import stage_site


STAMP = "2026-01-01T12:00:00+00:00"
BASE = "https://emi-collection.unifr.ch/directus"


class StageSiteTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name) / "source"
        (self.root / "data").mkdir(parents=True)
        (self.root / "assets" / "collectors").mkdir(parents=True)
        (self.root / "assets" / "js").mkdir()
        for name in stage_site.STATIC_FILES:
            (self.root / name).write_bytes(("static:" + name).encode())
        (self.root / "assets" / "js" / "app.js").write_text("window.app = true;", encoding="utf-8")
        for ident in (5, 9):
            (self.root / "assets" / "collectors" / f"{ident}.webp").write_bytes(bytes([ident]))
        catalog = copy.deepcopy(json.loads((stage_site.ROOT / "data" / "gardens.json").read_text()))
        self.catalog = catalog
        projects = ["jbuf", "bg-unifr", "jbc", "jbn", "jbn-new", "jbp", "jbp-new",
                    "kew-botanical-gardens", "unrelated-project"]
        samples = [[100 + index, f"sample-{index}", project, "Plant", 7.0, 46.0, None,
                    6 if index == 4 else 7 if index == 9 else 5, "accepted_exact", None]
                   for index, project in enumerate(projects, 1)]
        taxa = [[1, "ROOT", "Plantae", None, "kingdom", None, "version"],
                [2, "ORDER", "Order", None, "order", 1, "version"],
                [3, "FAMILY", "Family", None, "family", 2, "version"],
                [4, "GENUS", "Genus", None, "genus", 3, "version"],
                [5, "SPECIES", "Species", None, "species", 4, "version"],
                [6, "SUBSPECIES", "Subspecies", None, "subspecies", 5, "version"],
                [7, "OUTSIDE", "Other species", None, "species", 1, "version"]]
        groups = []
        for garden in catalog["gardens"]:
            count = sum(row[2] in garden["aliases"] for row in samples)
            groups.append({"id": garden["id"], "garden": garden["name"],
                           "projects": garden["aliases"], "samples": count,
                           "collected_only": count - 2 * (garden["id"] == "neuchatel"),
                           "extraction_record_present": 0,
                           "ms_record_present": 2 * int(garden["id"] == "neuchatel")})
        self.data = {
            "gardens": catalog,
            "samples": {"source": BASE, "generated_at": STAMP, "total_rows": len(samples),
                        "columns": stage_site.SAMPLE_COLUMNS, "taxon_columns": stage_site.TAXON_COLUMNS,
                        "rows": samples, "taxa": taxa},
            "garden_progress": {"source": BASE + "/items/", "generated_at": STAMP,
                                "method": "Field data stages. Status counts describe records, not verified success or instrument files.",
                                "total_samples": 8, "gardens": groups, "ms_without_extraction_samples": 2,
                                "record_statuses": {"MS_Data": {"OUTSIDE": 12345}},
                                "unlinked_processing_records": {"OUTSIDE": 67890}},
            "collectors": {"source": BASE, "generated_at": STAMP,
                           "sample_snapshot_generated_at": STAMP, "total_field_rows": 9,
                           "unlinked_named_samples": 8,
                           "collectors": [{"id": 5, "name": "A", "field_ids": [101, 105],
                                           "portrait": "assets/collectors/5.webp"},
                                          {"id": 9, "name": "B", "field_ids": [109],
                                           "portrait": "assets/collectors/9.webp"}]},
            "processing": {"source": BASE + "/items/", "generated_at": STAMP,
                           "columns": stage_site.PROCESSING_COLUMNS,
                           "records": [["dried", 1, 105, 11, "sample-5", None, "OK"],
                                       ["ms", 10, 105, None, None, 11, "OK"],
                                       ["ms", 12, 104, None, None, 14, "pending"],
                                       ["ms", 11, 109, None, None, 19, "OUTSIDE"]],
                           "total_ms_records": 9999, "excluded_outside_snapshot_ms": 8888},
            "ms_profile": {"source": BASE + "/items/", "generated_at": STAMP,
                           "method": "Directus FK lineage. Exclusions are mutually exclusive in status, file, unlinked lineage, outside published snapshot order.",
                           "profiles": [[10, 105, 1, "OK", "sample-5.mzML", 1],
                                        [11, 109, 2, "OK", None, 2]],
                           "instruments": [[1, "CODE1", "Model 1"], [2, "CODE2", "Model 2"]],
                           "injection_methods": [[1, "positive"], [2, "negative"]],
                           "total_ms_records": 9999, "gnps_filenames_unavailable": 8888,
                           "excluded_outside_snapshot_ms": 7777},
            "inaturalist": {"source": BASE + "/items/Curation_Data", "generated_at": STAMP,
                            "sample_generated_at": STAMP, "columns": stage_site.INAT_COLUMNS,
                            "rows": [["sample-5", 105, 50, None, None, None, None, None, None,
                                      "SPECIES", "Species", "species", "agreement", "same", [], 0, "iNaturalist API"],
                                     ["sample-9", 109, 90, None, None, None, None, None, None,
                                      "OUTSIDE", "Other species", "species", "agreement", "same", [], 0, "iNaturalist API"]],
                            "linked_samples": 2, "source_count": 9999},
            "wikidata_taxa": {"source": "https://query.wikidata.org/sparql",
                              "property": "P10585", "generated_at": STAMP,
                              "rows": [["SPECIES", "Q100"], ["OUTSIDE", "Q900"]],
                              "requested_ids": 9999, "matched_ids": 9999,
                              "ambiguous_ids": 99, "unmatched_ids": 9999},
            "refresh": {"completed_at": "2026-01-01T12:10:00+00:00",
                        "sample_generated_at": STAMP,
                        "snapshots": {name: STAMP for name in stage_site.REFRESH_FILES}},
        }
        self.save()

    def save(self):
        for name, value in self.data.items():
            (self.root / "data" / f"{name}.json").write_text(
                json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")

    def publish(self, site="dbgi"):
        output = self.root / ("site-" + site)
        stage_site.stage(site, output, self.root)
        return output

    def test_dbgi_scope_joins_aliases_and_retains_taxonomy_ancestors(self):
        output = self.publish()
        data = {name: json.loads((output / "data" / (name + ".json")).read_text())
                for name in stage_site.DATA_FILES}
        samples = data["samples"]
        self.assertEqual(samples["site"], "dbgi")
        self.assertEqual(samples["total_rows"], 8)
        self.assertEqual({row[2] for row in samples["rows"]}, stage_site.GARDEN_IDS)
        self.assertEqual([row[2] for row in samples["rows"][:2]], ["fribourg", "fribourg"])
        self.assertEqual([row[2] for row in samples["rows"][3:5]], ["neuchatel", "neuchatel"])
        self.assertEqual({row[0] for row in samples["taxa"]}, set(range(1, 7)))
        self.assertEqual({row[5] for row in samples["taxa"] if row[5] is not None}, set(range(1, 6)))
        self.assertEqual({garden["aliases"][0] for garden in data["gardens"]["gardens"]}, stage_site.GARDEN_IDS)
        progress = data["garden_progress"]
        self.assertEqual(progress["site"], "dbgi")
        self.assertEqual(progress["total_samples"], 8)
        self.assertEqual({project for garden in progress["gardens"] for project in garden["projects"]},
                         stage_site.GARDEN_IDS)
        self.assertNotIn("record_statuses", progress)
        self.assertNotIn("unlinked_processing_records", progress)
        self.assertNotIn("Status counts describe", progress["method"])
        collectors = data["collectors"]
        self.assertEqual(collectors["total_field_rows"], 8)
        self.assertEqual(collectors["site"], "dbgi")
        self.assertIsNone(collectors["unlinked_named_samples"])
        self.assertEqual(collectors["collectors"][0]["field_ids"], [101, 105])
        self.assertEqual([person["id"] for person in collectors["collectors"]], [5])
        self.assertTrue((output / "assets" / "collectors" / "5.webp").is_file())
        self.assertFalse((output / "assets" / "collectors" / "9.webp").exists())
        self.assertFalse((output / "scripts").exists())
        self.assertEqual([row[2] for row in data["processing"]["records"]], [105, 105, 104])
        self.assertEqual(data["processing"]["total_ms_records"], 2)
        self.assertFalse(any(key.startswith("excluded_") for key in data["processing"]))
        self.assertEqual(data["ms_profile"]["profiles"], [[10, 105, 1, "OK", "sample-5.mzML", 1]])
        self.assertEqual(data["ms_profile"]["instruments"], [[1, "CODE1", "Model 1"]])
        self.assertEqual(data["ms_profile"]["injection_methods"], [[1, "positive"]])
        self.assertEqual(data["ms_profile"]["total_ms_records"], 2)
        self.assertEqual(data["ms_profile"]["gnps_filenames_unavailable"], 0)
        self.assertFalse(any(key.startswith("excluded_") for key in data["ms_profile"]))
        self.assertEqual([row[1] for row in data["inaturalist"]["rows"]], [105])
        self.assertEqual(data["inaturalist"]["linked_samples"], 1)
        self.assertNotIn("source_count", data["inaturalist"])
        self.assertEqual(data["wikidata_taxa"]["rows"], [["SPECIES", "Q100"]])
        self.assertEqual(data["wikidata_taxa"]["requested_ids"], 1)
        self.assertNotIn("ambiguous_ids", data["wikidata_taxa"])
        self.assertEqual(json.loads((output / "data" / "refresh.json").read_text()), self.data["refresh"])
        self.assertEqual(data["collectors"]["sample_snapshot_generated_at"], samples["generated_at"])

    def test_emi_copies_original_snapshots_and_assets_byte_for_byte(self):
        output = self.publish("emi")
        for name in (*stage_site.DATA_FILES, "refresh"):
            self.assertEqual((output / "data" / f"{name}.json").read_bytes(),
                             (self.root / "data" / f"{name}.json").read_bytes())
        for name in stage_site.STATIC_FILES:
            self.assertEqual((output / name).read_bytes(), (self.root / name).read_bytes())
        self.assertTrue((output / "assets" / "collectors" / "9.webp").is_file())
        self.assertFalse((output / "scripts").exists())

    def test_optional_refresh_is_only_staged_when_present(self):
        self.data.pop("refresh")
        (self.root / "data" / "refresh.json").unlink()
        output = self.publish()
        self.assertFalse((output / "data" / "refresh.json").exists())

    def test_catalog_and_progress_cannot_disagree_or_map_ambiguous_projects(self):
        edits = (
            ("gardens", lambda x: x["gardens"][2]["aliases"].append("jbuf")),
            ("gardens", lambda x: x["gardens"][1]["aliases"].append("")),
            ("gardens", lambda x: x["gardens"][1]["aliases"].append("../outside")),
            ("gardens", lambda x: x["gardens"][0].update(id="prague")),
            ("garden_progress", lambda x: x["gardens"][0].update(samples=1)),
            ("garden_progress", lambda x: x.update(total_samples=7)),
        )
        for index, (name, change) in enumerate(edits):
            with self.subTest(index=index):
                original = copy.deepcopy(self.data[name])
                change(self.data[name])
                self.save()
                with self.assertRaises(ValueError):
                    stage_site.stage("dbgi", self.root / "site-dbgi", self.root)
                self.assertFalse((self.root / "site-dbgi").exists())
                self.data[name] = original

    def test_linked_relations_and_refresh_fail_closed(self):
        edits = (
            ("samples", lambda x: x["taxa"][4].__setitem__(5, 999)),
            ("samples", lambda x: x["rows"][4].__setitem__(7, 999)),
            ("processing", lambda x: x["records"][0].__setitem__(2, 999)),
            ("processing", lambda x: x["records"][1].__setitem__(5, "not-an-id")),
            ("ms_profile", lambda x: x["profiles"][0].__setitem__(2, 999)),
            ("ms_profile", lambda x: x["profiles"][0].__setitem__(0, 999)),
            ("processing", lambda x: x["records"][1].__setitem__(2, 104)),
            ("ms_profile", lambda x: x["profiles"][0].__setitem__(5, 999)),
            ("inaturalist", lambda x: x["rows"][0].__setitem__(0, "sample-9")),
            ("inaturalist", lambda x: x["rows"][0].__setitem__(14, [["not-a-photo"]])),
            ("inaturalist", lambda x: x["rows"][0].__setitem__(9, "WRONG")),
            ("collectors", lambda x: x["collectors"][0]["field_ids"].append(999)),
            ("collectors", lambda x: x["collectors"][0].update(portrait="../9.webp")),
            ("samples", lambda x: x.update(unexpected_global_metadata=99999)),
        )
        for index, (name, change) in enumerate(edits):
            with self.subTest(index=index):
                original = copy.deepcopy(self.data[name])
                change(self.data[name])
                self.save()
                with self.assertRaises(ValueError):
                    stage_site.stage("dbgi", self.root / "site-dbgi", self.root)
                self.assertFalse((self.root / "site-dbgi").exists())
                self.data[name] = original

    def test_stale_refresh_marker_is_not_published_in_either_variant(self):
        self.data["refresh"]["snapshots"]["ms_profile"] = "2020-01-01T00:00:00+00:00"
        self.save()
        with self.assertWarnsRegex(UserWarning, "stale or inconsistent"):
            dbgi = self.publish()
        self.assertFalse((dbgi / "data" / "refresh.json").exists())
        with self.assertWarnsRegex(UserWarning, "stale or inconsistent"):
            emi = self.publish("emi")
        self.assertFalse((emi / "data" / "refresh.json").exists())
        self.assertEqual((emi / "data" / "samples.json").read_bytes(),
                         (self.root / "data" / "samples.json").read_bytes())

    def test_missing_linked_portrait_is_rejected(self):
        (self.root / "assets" / "collectors" / "5.webp").unlink()
        with self.assertRaises(ValueError):
            self.publish()


if __name__ == "__main__":
    unittest.main()
