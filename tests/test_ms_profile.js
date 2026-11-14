"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; }
  set textContent(text) { this.replaceChildren(String(text)); }
  get textContent() {
    return this.children.map((child) => child instanceof Node ? child.textContent : child).join("");
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(key, value) { this.attrs[key] = value; }
  findAll(tag) {
    return [...(this.tag === tag ? [this] : []),
      ...this.children.flatMap((child) => child instanceof Node ? child.findAll(tag) : [])];
  }
}

global.document = {createElement: (tag) => new Node(tag)};
global.window = {};
require("../scientific_names.js");
require("../ms_profile.js");
const {buildIndex, render} = window.MSProfile;
const directusBase = "https://emi-collection.unifr.ch/directus";
const source = `${directusBase}/items/`;
const genus = [1, "GENUS", "Echeveria", null, "genus", null, "2026"];
const species = [2, "COL-A", "Echeveria elegans", "Rose", "species", 1, "2026"];
const variety = [3, "COL-V", "Echeveria elegans var. rosea", null, "variety", 2, "2026"];
const other = [4, "COL-B", "Echeveria agavoides", null, "species", 1, "2026"];
const taxaById = new Map([genus, species, variety, other].map((taxon) => [taxon[0], taxon]));
const fields = [
  [10, "dbgi_000010", "P", "Field label", null, null, null, 2, "resolved"],
  [11, "dbgi_000011", "P", "Different field label", null, null, null, 3, "resolved"],
  [12, "dbgi_000012", "P", "Echeveria elegans", null, null, null, 4, "resolved"],
  [13, "dbgi_000013", "P", null, null, null, null, null, "unresolved"],
  [14, "dbgi_000014", "P", "Genus only", null, null, null, 1, "resolved"],
];
const rowsById = new Map(fields.map((row) => [row[0], row]));
const snapshot = {source, generated_at: "2026-11-14T00:00:00Z", method: "container lineage",
  instruments: [[2, "inst_000002", "LC-MS QExactive HFX"], [3, "inst_000003", "Orbitrap Exploris"]],
  profiles: [[100, 10, 2, "published", "one.mzML"], [101, 10, 3, "OK", "two.mzML"],
    [102, 11, 2, "OK", null], [103, 14, 3, "OK", "four.mzML"]],
  total_ms_records: 4, excluded_unlinked_ms: 0, excluded_outside_snapshot_ms: 0,
  excluded_without_file_ms: 0, excluded_other_status_ms: 0};
const index = buildIndex(snapshot, rowsById, taxaById);
const show = (root, row, idx = index, map = taxaById) =>
  render(root, {row, taxaById: map, index: idx, directusBase});

test("species ancestor combines distinct field samples but never presents another sample's MS files as this one's", () => {
  assert.deepEqual(index.byField.get(10), snapshot.profiles.slice(0, 2));
  assert.deepEqual(index.byField.get(10).map((record) => record[4]), ["one.mzML", "two.mzML"]);
  assert.equal(index.byField.get(11)[0][4], null);
  const root = new Node("aside");
  show(root, fields[1]);
  assert.match(root.textContent, /MS profile recorded.*Echeveria elegans/);
  assert.match(root.textContent, /2 distinct linked field samples/);
  assert.equal(root.findAll("i")[0].textContent, "Echeveria elegans");
  assert.equal(root.findAll("a").filter((link) => link.href.includes("/MS_Data/" )).length, 1);
  assert.equal(root.findAll("a").find((link) => link.href.endsWith("/MS_Data/102")).textContent, "MS_Data #102");
  show(root, fields[0]);
  assert.equal(root.findAll("a").filter((link) => link.href.includes("/MS_Data/")).length, 2);
  assert.match(root.textContent, /This field sample: 2 linked MS files/);
  assert.equal(root.findAll("a").some((link) => link.href.endsWith("/MS_Data/102")), false);
});

test("multiple physical instruments render separate safe Directus links with model and code", () => {
  const root = new Node("aside");
  show(root, fields[1]);
  const instruments = root.findAll("a").filter((link) => link.href.includes("/Instruments/"));
  assert.deepEqual(instruments.map((link) => link.textContent),
    ["LC-MS QExactive HFX (inst_000002)", "Orbitrap Exploris (inst_000003)"]);
  assert.deepEqual(instruments.map((link) => link.href), [2, 3].map((id) =>
    `${directusBase}/admin/content/Instruments/${id}`));
  for (const link of root.findAll("a")) {
    assert.equal(link.target, "_blank");
    assert.equal(link.rel, "noopener noreferrer");
    assert.equal(link.referrerPolicy, "no-referrer");
    assert.match(link.attrs["aria-label"], /opens in a new tab/);
    assert.match(link.href, /^https:\/\/emi-collection\.unifr\.ch\/directus\/admin\/content\/(?:MS_Data|Instruments)\/\d+$/);
  }
  assert.equal(root.attrs["aria-label"], "Mass spectrometry profile status");
});

test("same-species unprofiled field sample shows species evidence but no specimen-level claim", () => {
  const row = [15, "dbgi_000015", "P", "Unrelated label", null, null, null, 3, "resolved"];
  const map = new Map(rowsById).set(15, row);
  const root = new Node("aside");
  render(root, {row, taxaById, index: buildIndex(snapshot, map, taxaById), directusBase});
  assert.match(root.textContent, /MS profile recorded/);
  assert.match(root.textContent, /This field sample: No linked MS file recorded/);
  assert.match(root.textContent, /from other field samples/);
  assert.equal(root.findAll("a").filter((link) => link.href.includes("/MS_Data/")).length, 0);
});

test("different species, unresolved taxa and missing snapshot return distinct neutral statuses", () => {
  const root = new Node("aside");
  show(root, fields[2]);
  assert.match(root.textContent, /No linked MS file recorded.*Echeveria agavoides/);
  assert.doesNotMatch(root.textContent, /MS profile recorded|No analysis/);
  assert.equal(root.findAll("a").length, 0);
  for (const field of [fields[3], fields[4]]) {
    show(root, field);
    assert.match(root.textContent, /Species unresolved · MS profile status unknown/);
    assert.doesNotMatch(root.textContent, /No linked MS file recorded|MS profile recorded/);
  }
  assert.deepEqual(root.findAll("a").map((link) => link.href),
    [`${directusBase}/admin/content/MS_Data/103`]);
  show(root, fields[0], null);
  assert.equal(root.textContent, "MS profile data unavailable");
  assert.equal(root.findAll("a").length, 0);
  const cyclic = [7, "CYCLE", "Cycle", null, "variety", 7, "2026"];
  const cycleField = [17, "dbgi_000017", "P", null, null, null, null, 7, "resolved"];
  const cyclicTaxa = new Map(taxaById).set(7, cyclic);
  const cyclicRows = new Map(rowsById).set(17, cycleField);
  render(root, {row: cycleField, taxaById: cyclicTaxa,
    index: buildIndex(snapshot, cyclicRows, cyclicTaxa), directusBase});
  assert.match(root.textContent, /Species unresolved/);
});

test("malformed source, unknown instruments, duplicate MS ids, and stale Field_Data/Taxa references fail closed", () => {
  const broken = (changes) => ({...snapshot, ...changes});
  assert.throws(() => buildIndex(broken({source: "https://other.example/items/"}), rowsById, taxaById), /snapshot/);
  assert.throws(() => buildIndex(broken({profiles: [[100, 10, 99, "OK", "one.mzML"]]}), rowsById, taxaById), /profile/);
  assert.throws(() => buildIndex(broken({profiles: [[100, 10, 2, "OK", "one.mzML"],
    [100, 11, 2, "OK", "two.mzML"]]}), rowsById, taxaById), /duplicate/);
  assert.throws(() => buildIndex(broken({instruments: [...snapshot.instruments, snapshot.instruments[0]]}), rowsById, taxaById), /duplicate/);
  assert.throws(() => buildIndex(broken({profiles: [[100, 999, 2, "OK", null]]}), rowsById, taxaById), /Field_Data/);
  assert.throws(() => buildIndex(broken({profiles: [[100, 10, 2, "pending", null]]}), rowsById, taxaById), /profile/);
  for (const filename of ["../other.mzML", "folder/file.mzML", "folder\\file.mzML", "", "..", 123]) {
    assert.throws(() => buildIndex(broken({profiles: [[100, 10, 2, "OK", filename]]}),
      rowsById, taxaById), /profile/);
  }
  assert.throws(() => buildIndex(broken({profiles: [[100, 10, 2, "OK"]]}),
    rowsById, taxaById), /profile/);
  const stale = new Map(rowsById).set(10, [...fields[0].slice(0, 7), 999, "resolved"]);
  assert.throws(() => buildIndex(snapshot, stale, taxaById), /Taxa/);
  const root = new Node("aside");
  show(root, [...fields[0].slice(0, 7), 4, "resolved"]);
  assert.match(root.textContent, /status unknown/);
  assert.equal(root.findAll("a").length, 0);
});

test("dynamic navigation clears previous species instruments and MS links; source labels are inserted as text", () => {
  const root = new Node("aside");
  show(root, fields[0]);
  show(root, fields[2]);
  assert.equal(root.findAll("a").length, 0);
  assert.doesNotMatch(root.textContent, /QExactive|MS_Data|profile recorded/);
  const injected = [8, "COL-X", "<img src=x onerror=alert(1)>", null, "species", 1, "2026"];
  const field = [18, "dbgi_000018", "P", null, null, null, null, 8, "resolved"];
  const snapshotX = {...snapshot, instruments: [[9, "<script>console.log(1)</script>", "Model <b>test</b>"]],
    profiles: [[1000, 18, 9, "OK", "<img src=x onerror=alert(1)>.mzML"]]};
  const map = new Map(taxaById).set(8, injected);
  render(root, {row: field, taxaById: map, index: buildIndex(snapshotX, new Map([[18, field]]), map), directusBase});
  assert.match(root.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.match(root.textContent, /<script>console.log\(1\)<\/script>/);
  assert.equal(root.textContent.includes("<img src=x onerror=alert(1)>.mzML"), false);
  assert.equal(root.findAll("img").length, 0);
  assert.equal(root.findAll("script").length, 0);
  assert.equal(root.findAll("b").length, 0);
  show(root, fields[1]);
  assert.doesNotMatch(root.textContent, /<img|<script>/);
});
