"""Wikidata CoL species reconciliation and snapshot safety checks."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import build_wikidata_taxa as wikidata


def result(*pairs):
    return {"head": {"vars": ["col", "item"]}, "results": {"bindings": [
        {"col": {"type": "literal", "value": col},
         "item": {"type": "uri", "value": f"http://www.wikidata.org/entity/{qid}"}}
        for col, qid in pairs]}}


def snapshot():
    return {"taxa": [
        [1, "5CXX5", "Zea mays", "L.", "species", 4, "2026"],
        [2, "SUB2", "Zea mays subsp.", None, "subspecies", 3, "2026"],
        [3, "VAR3", "Zea mays var.", None, "variety", 1, "2026"],
        [4, "GEN4", "Zea", None, "genus", None, "2026"],
        [5, "OTH5", "Other species", None, "species", 4, "2026"],
        [6, "FORM6", "Zea mays form", None, "form", 1, "2026"],
    ], "rows": [[1, None, None, None, None, None, None, 2],
                [2, None, None, None, None, None, None, 3],
                [3, None, None, None, None, None, None, 4],
                [4, None, None, None, None, None, None, 6]]}


class WikidataTaxaTests(unittest.TestCase):
    def test_species_ancestor_only_from_sampled_taxa_lineage(self):
        self.assertEqual(wikidata.species_ids(snapshot()), ["5CXX5"])
        form_only = snapshot()
        form_only["rows"] = [form_only["rows"][-1]]
        self.assertEqual(wikidata.species_ids(form_only), ["5CXX5"])
        source = snapshot()
        source["rows"].append([5, None, None, None, None, None, None, 5])
        self.assertEqual(wikidata.species_ids(source), ["5CXX5", "OTH5"])
        source["taxa"][2][5] = 999
        with self.assertRaisesRegex(ValueError, "parent chain"):
            wikidata.species_ids(source)
        source["taxa"][2][5] = 2
        with self.assertRaisesRegex(ValueError, "parent chain"):
            wikidata.species_ids(source)

    def test_query_restricts_exact_ids_and_wikidata_species_rank(self):
        query = wikidata.query_for(["5CXX5"])
        self.assertIn('VALUES ?col { "5CXX5" }', query)
        self.assertIn("wdt:P10585 ?col", query)
        self.assertIn("wdt:P105 wd:Q7432", query)
        self.assertNotIn("scientific_name", query)

    def test_collision_omitted_duplicate_binding_collapsed(self):
        rows, counts = wikidata.reconcile(["5CXX5", "OTH5", "UNKNOWN"],
            fetch=lambda ids: result(("5CXX5", "Q11575"), ("5CXX5", "Q11575"),
                                     ("OTH5", "Q2"), ("OTH5", "Q3")))
        self.assertEqual(rows, [["5CXX5", "Q11575"]])
        self.assertEqual(counts, {"requested_ids": 3, "matched_ids": 1,
                                  "unmatched_ids": 1, "ambiguous_ids": 1})

    def test_invalid_or_foreign_binding_fails_closed(self):
        for payload in [result(("OTHER", "Q11575")), result(("5CXX5", "Q0")),
                        result(("5CXX5", "not-a-qid")), {"results": {"bindings": []}},
                        {"head": {"vars": ["col", "item"]}, "results": {"bindings": []},
                         "partial": True}]:
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                wikidata.parse_bindings(payload, {"5CXX5"})
        bad = result(("5CXX5", "Q11575"))
        bad["results"]["bindings"][0]["item"]["type"] = "literal"
        with self.assertRaises(ValueError):
            wikidata.parse_bindings(bad, {"5CXX5"})

    def test_failure_in_later_batch_never_overwrites_existing_snapshot(self):
        source = snapshot()
        source["rows"].append([5, None, None, None, None, None, None, 5])
        with tempfile.TemporaryDirectory() as directory:
            sample_path = Path(directory) / "samples.json"
            output_path = Path(directory) / "wikidata_taxa.json"
            sample_path.write_text(json.dumps(source), encoding="utf-8")
            output_path.write_text("previous verified snapshot", encoding="utf-8")
            with patch.object(wikidata, "SAMPLES", sample_path), patch.object(wikidata, "OUT", output_path), \
                 patch.object(wikidata, "BATCH_SIZE", 1), \
                 patch.object(wikidata, "fetch_batch", side_effect=[result(("5CXX5", "Q11575")),
                                                                   TimeoutError("timed out")]):
                with self.assertRaises(TimeoutError):
                    wikidata.build()
            self.assertEqual(output_path.read_text(encoding="utf-8"), "previous verified snapshot")
            with patch.object(wikidata, "SAMPLES", sample_path), patch.object(wikidata, "OUT", output_path), \
                 patch.object(wikidata, "BATCH_SIZE", 1), \
                 patch.object(wikidata, "fetch_batch", side_effect=[result(("5CXX5", "Q11575")),
                                                                   {"head": {"vars": ["col", "item"]},
                                                                    "results": {"bindings": []}, "partial": True}]):
                with self.assertRaisesRegex(ValueError, "Incomplete"):
                    wikidata.build()
            self.assertEqual(output_path.read_text(encoding="utf-8"), "previous verified snapshot")
            with patch.object(wikidata, "SAMPLES", sample_path), patch.object(wikidata, "OUT", output_path), \
                 patch.object(wikidata, "BATCH_SIZE", 1), \
                 patch.object(wikidata, "fetch_batch", side_effect=[result(("5CXX5", "Q11575")),
                                                                   result(("OTH5", "Q2"))]):
                wikidata.build()
            published = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(published["rows"], [["5CXX5", "Q11575"], ["OTH5", "Q2"]])
            self.assertEqual(published["property"], "P10585")
            self.assertEqual(published["source"], wikidata.ENDPOINT)


if __name__ == "__main__":
    unittest.main()
