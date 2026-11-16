"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
global.window = {};
require("../assets/js/sample_network.js");
const {build} = window.DBGISampleNetwork;
const taxa = new Map([
  [1, [1, "COL1", "Plantae", null, "kingdom", null]],
  [2, [2, "COL2", "Rubiaceae", null, "family", 1]],
  [3, [3, "COL3", "Coffea", null, "genus", 2]],
  [4, [4, "COL4", "Coffea arabica", "L.", "species", 3]],
  [5, [5, "COL5", "Asteraceae", null, "family", 1]],
]);
const gardens = {gardens: [
  {id: "fribourg", name: "Fribourg", aliases: ["jbuf", "bg-unifr"]},
  {id: "neuchatel", name: "Neuchâtel", aliases: ["jbn", "jbn-new"]},
  {id: "champex", name: "Champex", aliases: ["jbc"]},
]};
const sample = (id, name, project, lon, lat, taxon, subject) =>
  [id, name, project, name, lon, lat, null, taxon, null, subject];
const rows = [
  sample(11, "dbgi_000011", "jbuf", 7.15, 46.8, 4, "Leaf"),
  sample(12, "dbgi_000012", "bg-unifr", 7.17, 46.81, 4, "Flower"),
  sample(13, "dbgi_000013", "jbn", 6.92, 46.99, 3, null),
  sample(14, "dbgi_000014", "jbc", null, null, 2, "Root"),
  sample(15, "dbgi_000015", "jbp", 14.6, 50.1, 1, null),
  sample(16, "dbgi_000016", "private-project", -73.5, 40.7, null, "Leaf"),
  sample(17, "dbgi_000017", "jbn-new", null, null, 5, "Root"),
];
const linked = (model, a, b, relation) => model.edges.some((edge) =>
  edge.relation === relation && ((edge.from === model.nodes.get(a) && edge.to === model.nodes.get(b)) ||
    (edge.from === model.nodes.get(b) && edge.to === model.nodes.get(a))));

test("one actual sample joins its Taxa species, organ, project, garden and location in the same graph", () => {
  const graph = build(rows, taxa, gardens);
  assert.equal(graph.root.count, rows.length);
  assert.equal([...graph.nodes.values()].filter((node) => node.kind === "sample").length, rows.length);
  assert.equal(linked(graph, "sample:11", "taxon:4", "resolved as"), true);
  assert.equal(linked(graph, "taxon:4", "taxon:3", "parent Taxa"), true);
  assert.equal(linked(graph, "taxon:3", "taxon:2", "parent Taxa"), true);
  assert.equal(linked(graph, "sample:11", "subject:Leaf", "observation subject"), true);
  assert.equal(linked(graph, "sample:11", "project:jbuf", "recorded project"), true);
  assert.equal(linked(graph, "sample:11", "garden:fribourg", "botanical garden"), true);
  assert.equal(linked(graph, "sample:11", "geo:0.1:468:71", "recorded location"), true);
  assert.equal(linked(graph, "project:jbuf", "garden:fribourg", "garden project"), true);
  assert.equal(graph.nodes.get("taxon:4").count, 2);
  assert.equal(graph.nodes.get("taxon:2").count, 4);
});

test("different samples reuse one taxon, one organ and one garden; unresolved and unlocated records remain visible", () => {
  const graph = build(rows, taxa, gardens);
  assert.equal(linked(graph, "sample:12", "taxon:4", "resolved as"), true);
  assert.equal(linked(graph, "sample:12", "garden:fribourg", "botanical garden"), true);
  assert.equal(graph.nodes.get("garden:fribourg").count, 2);
  assert.equal(linked(graph, "sample:16", "subject:Leaf", "observation subject"), true);
  assert.equal(graph.nodes.get("subject:Leaf").count, 2);
  assert.equal(linked(graph, "sample:16", "taxon:unresolved", "unresolved Taxa"), true);
  assert.equal(linked(graph, "sample:14", "geo:missing", "coordinates unavailable"), true);
  assert.equal(graph.nodes.get("geo:missing").count, 2);
  assert.equal(graph.nodes.get("garden:other").count, 2);
  assert.equal(graph.nodes.get("garden:neuchatel").count, 2);
});

test("search connects a sample to its subject hub and expands all cross-facet relationships without replacing the scene", () => {
  const graph = build(rows, taxa, gardens);
  const scene = graph.scene();
  assert.equal(scene.sceneNodes().length, 5);
  const record = graph.search("dbgi_000011")[0];
  scene.select(record);
  assert.equal(scene.shown.has(graph.nodes.get("subject:Leaf")), true);
  assert.equal(scene.shown.has(graph.hubs.subject), true);
  const result = scene.expand(record);
  assert.ok(result.added >= 4);
  for (const key of ["sample:11", "taxon:4", "subject:Leaf", "project:jbuf", "garden:fribourg", "geo:0.1:468:71"]) {
    assert.equal(scene.shown.has(graph.nodes.get(key)), true, key);
  }
  const before = scene.shown.size;
  const family = graph.search("Rubiaceae")[0];
  scene.select(family);
  assert.equal(scene.shown.has(record), true, "searching another entity preserves existing nodes");
  assert.ok(scene.shown.size > before);
  assert.equal(scene.shown.has(graph.nodes.get("taxon:1")), true, "taxon path uses Directus parent edges");
  scene.expand(graph.nodes.get("taxon:4"), "out|parent Taxa");
  assert.equal(scene.shown.has(graph.nodes.get("taxon:3")), true);
  assert.equal(linked(graph, "sample:11", "taxon:4", "resolved as"), true);
});

test("typed expansion distinguishes a Taxa parent from its children", () => {
  const graph = build(rows, taxa, gardens), scene = graph.scene();
  const family = graph.nodes.get("taxon:2");
  scene.select(family);
  assert.equal(scene.shown.has(graph.nodes.get("taxon:1")), true);
  assert.equal(scene.expand(family, "out|parent Taxa").added, 0,
    "the parent is already visible in the source-backed ancestry route");
  assert.equal(scene.expand(family, "in|parent Taxa").added, 1);
  assert.equal(scene.shown.has(graph.nodes.get("taxon:3")), true);
  assert.equal(scene.shown.has(graph.nodes.get("sample:14")), false,
    "a child-Taxa filter does not mix in directly identified samples");
});

test("selecting any entity keeps an actual route to its category and focusing removes unrelated neighborhoods", () => {
  const graph = build(rows, taxa, gardens);
  const scene = graph.scene();
  const garden = graph.nodes.get("garden:fribourg");
  scene.select(garden);
  scene.expand(garden);
  const sample = graph.nodes.get("sample:11");
  scene.select(sample);
  assert.equal(scene.shown.has(garden), true);
  const family = graph.nodes.get("taxon:2");
  scene.focus(family);
  assert.equal(scene.shown.has(family), true);
  assert.equal(scene.shown.has(graph.nodes.get("taxon:1")), true);
  assert.equal(scene.shown.has(sample), false);
  assert.equal(scene.shown.has(graph.nodes.get("taxon:3")), true);
  scene.select(graph.nodes.get("project:private-project"));
  assert.equal(scene.shown.has(graph.nodes.get("garden:other")), true,
    "projects outside the five gardens connect through the other-project group");
  scene.select(graph.nodes.get("geo:0.1:468:71"));
  assert.equal(scene.shown.has(graph.nodes.get("geo:1:46:7")), true,
    "precise coordinate cells retain their actual parent region");
  scene.reset();
  assert.deepEqual(scene.sceneNodes().map((node) => node.id), [
    "root", "hub:taxonomy", "hub:gardens", "hub:subject", "hub:geography"]);
});

test("dense observed organs add bounded pages, retain cross-sample relationships and cap the scene", () => {
  const many = Array.from({length: 260}, (_, index) =>
    sample(index + 1, `dbgi_${index + 1}`, "jbuf", 7, 46, 4, "Leaf"));
  const graph = build(many, taxa, gardens), scene = graph.scene();
  const organ = graph.nodes.get("subject:Leaf");
  assert.equal(organ.count, 260);
  assert.equal(organ.links.length, 261, "organ hub plus 260 distinct sample edges");
  scene.select(organ);
  const first = scene.expand(organ);
  assert.equal(first.added, 24);
  assert.ok(first.remaining > 200);
  assert.equal(scene.expand(organ).added, 24);
  assert.equal(new Set(scene.sceneNodes()).size, scene.sceneNodes().length);
  const last = graph.nodes.get("sample:260");
  scene.select(last);
  assert.equal(scene.shown.has(last), true,
    "searching a sample outside the first organ page keeps its exact record");
  for (let page = 0; page < 10; page++) scene.expand(organ);
  assert.equal(scene.sceneNodes().length, 160, "progressive expansion never freezes the browser with thousands of nodes");
  scene.focus(organ);
  assert.ok(scene.sceneNodes().length <= 30);
  assert.equal([...graph.nodes.values()].filter((node) => node.kind === "sample").length, 260);
});

test("coordinate boundaries, malformed field IDs and broken Taxa ancestry are not silently assigned", () => {
  const boundary = build([sample(19, "dbgi_000019", "jbuf", 7.2, 46.8, 4, "Leaf")], taxa, gardens);
  assert.equal(boundary.nodes.get("geo:0.1:468:72").label, "46.8–46.9° lat · 7.2–7.3° lon");
  const pole = build([sample(20, "dbgi_000020", "jbuf", 180, 90, 4, "Leaf")], taxa, gardens);
  assert.ok(pole.nodes.has("geo:10:8:17"));
  assert.throws(() => build([...rows, rows[0]], taxa, gardens), /Duplicate/);
  assert.throws(() => build([sample(0, "dbgi_bad", "jbuf", 7, 46, 4, null)], taxa, gardens), /invalid/);
  assert.throws(() => build([sample(21, "unknown", "jbuf", 7, 46, 999, null)], taxa, gardens), /Incomplete/);
});
