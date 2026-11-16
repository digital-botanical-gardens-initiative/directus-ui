"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; }
  set textContent(value) { this.replaceChildren(String(value)); }
  get textContent() {
    return this.children.map((child) => child instanceof Node ? child.textContent : child).join("");
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attrs[name] = value; }
  findAll(tag) {
    return [...(this.tag === tag ? [this] : []),
      ...this.children.flatMap((child) => child instanceof Node ? child.findAll(tag) : [])];
  }
  byClass(name) {
    return [...(this.className?.split(" ").includes(name) ? [this] : []),
      ...this.children.flatMap((child) => child instanceof Node ? child.byClass(name) : [])];
  }
}

global.document = {createElement: (tag) => new Node(tag)};
global.window = {};
require("../assets/js/processing.js");
const {buildIndex, render} = window.DBGIProcessing;
const base = "https://emi-collection.unifr.ch/directus";
const columns = ["kind", "id", "field_id", "container_id", "container_label", "parent_container_id", "status"];
const fields = [[10, "dbgi_000010", "Project", "Example species"],
  [11, "dbgi_000011", "Project", "Example species"],
  [12, "dbgi_000012", "Project", "Unlinked"]];
const fieldsById = new Map(fields.map((field) => [field[0], field]));
const records = [
  ["dried", 22, 10, 202, "dry-B", 102, "Pending"],
  ["aliquot", 44, 10, 404, "aliquot-A", 303, null],
  ["dried", 21, 10, 201, "dry-A", 101, null],
  ["extract", 31, 10, 303, "extract-A", 201, "In progress"],
  ["extract", 32, 10, 302, "extract-B", 202, "Queued"],
  ["ms", 51, 10, null, null, 404, "Imported"],
  ["ms", 52, 10, null, null, 101, null],
  ["dried", 23, 11, 203, "other field", 103, "Recorded"],
];
const snapshot = {source: `${base}/items/`, generated_at: "2026-11-14T00:00:00Z", columns, records};
const index = buildIndex(snapshot, fieldsById, base);
const draw = (root, row, idx = index) => render(root, {row, index: idx, directusBase: base});

function linkedCard(root, kind, id) {
  return root.byClass(`processing-card--${kind}`).find((node) =>
    node.byClass("processing-card-title")[0].findAll("a")[0].href.endsWith(`/${id}`));
}

test("indexes by field with stable stage/id ordering and distinct branches", () => {
  assert.equal(Object.isFrozen(window.DBGIProcessing), true);
  assert.deepEqual(index.byField.get(10).map(([kind, id]) => `${kind}:${id}`),
    ["dried:21", "dried:22", "extract:31", "extract:32", "aliquot:44", "ms:51", "ms:52"]);
  assert.deepEqual(index.byField.get(11), [records[7]]);
  assert.equal(index.byField.has(12), false);
  const root = new Node("section");
  draw(root, fields[0]);
  assert.deepEqual(root.byClass("processing-roots")[0].children.map((node) =>
    node.byClass("processing-card-title")[0].textContent),
  ["Dried sample · Dried_Samples_Data #21", "Dried sample · Dried_Samples_Data #22",
    "MS record · MS_Data #52"]);
  const a = linkedCard(root, "dried", 21);
  const b = linkedCard(root, "dried", 22);
  assert.ok(linkedCard(a, "extract", 31));
  assert.ok(linkedCard(linkedCard(a, "extract", 31), "aliquot", 44));
  assert.ok(linkedCard(linkedCard(linkedCard(a, "extract", 31), "aliquot", 44), "ms", 51));
  assert.ok(linkedCard(b, "extract", 32));
  assert.equal(b.textContent.includes("extract-A"), false);
  assert.doesNotMatch(root.textContent, /other field/);
  assert.match(root.textContent, /Recorded parent container#101/);
  assert.match(root.textContent, /Not recorded/);
  assert.match(root.textContent, /In progress/);
  assert.doesNotMatch(root.textContent, /success|passed|complete/i);
});

test("links all four collections and physical containers safely and shows recorded unexported parents", () => {
  const root = new Node("section");
  draw(root, fields[0]);
  for (const [kind, collection, id] of [["dried", "Dried_Samples_Data", 21],
    ["extract", "Extraction_Data", 31], ["aliquot", "Aliquoting_Data", 44],
    ["ms", "MS_Data", 51]]) {
    assert.equal(linkedCard(root, kind, id).byClass("processing-card-title")[0].findAll("a")[0].href,
      `${base}/admin/content/${collection}/${id}`);
  }
  const directMS = linkedCard(root, "ms", 52);
  assert.equal(directMS.findAll("a").find((link) => link.href.endsWith("/Containers/101")).textContent, "#101");
  assert.equal(root.findAll("a").some((link) => link.href.endsWith("/Containers/201")), true);
  for (const link of root.findAll("a")) {
    assert.match(link.href, /^https:\/\/emi-collection\.unifr\.ch\/directus\/admin\/content\/(?:Dried_Samples_Data|Extraction_Data|Aliquoting_Data|MS_Data|Containers)\/\d+$/);
    assert.equal(link.target, "_blank");
    assert.equal(link.rel, "noopener noreferrer");
    assert.equal(link.referrerPolicy, "no-referrer");
  }
});

test("nested aliquots from Directus are linked without inventing a step; cycles fail closed", () => {
  const nested = {...snapshot, records: [...records,
    ["aliquot", 45, 10, 405, "aliquot-A-subdivision", 404, "present"],
    ["ms", 53, 10, null, null, 405, "OK"]]};
  const root = new Node("section");
  draw(root, fields[0], buildIndex(nested, fieldsById, base));
  const first = linkedCard(linkedCard(root, "extract", 31), "aliquot", 44);
  const second = linkedCard(first, "aliquot", 45);
  assert.ok(second);
  assert.ok(linkedCard(second, "ms", 53));
  assert.throws(() => buildIndex({...snapshot, records: [
    ["aliquot", 45, 10, 405, "A", 406, "present"],
    ["aliquot", 46, 10, 406, "B", 405, "present"],
  ]}, fieldsById, base), /Cyclic/);
});

test("rejects malformed snapshots, IDs, field references, duplicate records, and cross-field parent links", () => {
  const broken = (change) => ({...snapshot, ...change});
  const invalid = (value, pattern) => assert.throws(() => buildIndex(value, fieldsById, base), pattern);
  invalid(broken({source: "https://other.example/items/"}), /snapshot/);
  invalid(broken({columns: [...columns, "made_up"]}), /snapshot/);
  invalid(broken({columns: [...columns.slice(0, 2), "other", ...columns.slice(3)]}), /snapshot/);
  invalid(broken({records: [["weird", 1, 10, 201, "label", null, null]]}), /record/);
  invalid(broken({records: [["ms", 1, 10, 200, "container", null, null]]}), /record/);
  invalid(broken({records: [["dried", 1, 10, 201, "label", null, 5]]}), /record/);
  invalid(broken({records: [["dried", 1, 10, 201, "label", -5, null]]}), /record/);
  invalid(broken({records: [["dried", 1, 999, 201, "label", null, null]]}), /Field_Data/);
  invalid(broken({records: [records[0], records[0]]}), /Duplicate/);
  invalid(broken({records: [["dried", 22, 10, 202, "a", null, null],
    ["extract", 31, 10, 202, "b", null, null]]}), /Duplicate/);
  invalid(broken({records: [["dried", 1, 11, 201, "other", null, null],
    ["extract", 2, 10, 301, "mine", 201, null]]}), /different Field_Data/);
  invalid(broken({records: [["extract", 2, 10, 301, "child", 201, null],
    ["aliquot", 3, 10, 201, "parent", null, null]]}), /parent stage/);
  assert.throws(() => buildIndex(snapshot, fieldsById, "javascript:alert(1)"), /snapshot/);
});

test("orphan container references remain recorded, not fabricated ancestors", () => {
  const orphan = { ...snapshot, records: [["aliquot", 91, 10, 991, "orphan", 888, "held"],
    ["ms", 92, 10, null, null, null, null]]};
  const root = new Node("section");
  draw(root, fields[0], buildIndex(orphan, fieldsById, base));
  assert.equal(root.byClass("processing-roots")[0].children.length, 2);
  assert.match(root.textContent, /Recorded parent container#888/);
  assert.equal(root.findAll("a").find((link) => link.href.endsWith("/Containers/888")).textContent, "#888");
  assert.equal(root.byClass("processing-children").length, 0);
});

test("rerender clears stale links and safely inserts source-provided labels", () => {
  const root = new Node("section");
  draw(root, fields[0]);
  draw(root, fields[2]);
  assert.match(root.textContent, /No linked processing records/);
  assert.equal(root.findAll("a").length, 0);
  draw(root, fields[0], null);
  assert.match(root.textContent, /Processing snapshot unavailable/);
  assert.equal(root.findAll("a").length, 0);
  draw(root, [...fields[0].slice(0, 1), "changed sample id"]);
  assert.match(root.textContent, /Field sample processing data unavailable/);
  const unsafe = {...snapshot, records: [["dried", 99, 10, 999,
    "<img src=x onerror=alert(1)>", null, "<script>alert(1)</script>"]]};
  draw(root, fields[0], buildIndex(unsafe, fieldsById, base));
  assert.match(root.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.match(root.textContent, /<script>alert\(1\)<\/script>/);
  assert.equal(root.findAll("img").length, 0);
  assert.equal(root.findAll("script").length, 0);
  draw(root, fields[1]);
  assert.equal(root.textContent.includes("<img"), false);
});
