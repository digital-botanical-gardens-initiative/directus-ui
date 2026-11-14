"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.events = new Map(); }
  set textContent(value) { this.replaceChildren(String(value)); }
  get textContent() {
    return this.children.map((child) => child instanceof Node ? child.textContent : child).join("");
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  addEventListener(type, handler) { this.events.set(type, handler); }
  setAttribute(name, value) { this[name] = value; }
  dispatch(type) { this.events.get(type)?.({preventDefault() {}}); }
  contains(node) { return this === node || this.children.some((child) => child instanceof Node && child.contains(node)); }
  findAll(tag) {
    return [...(this.tag === tag ? [this] : []),
      ...this.children.flatMap((child) => child instanceof Node ? child.findAll(tag) : [])];
  }
}
function cls(node, name) {
  if (node.className === name) return node;
  for (const child of node.children) {
    if (child instanceof Node) {
      const found = cls(child, name);
      if (found) return found;
    }
  }
  return null;
}
const buttons = (root, prefix) => root.findAll("button").filter((button) => button.textContent.startsWith(prefix));
const click = (node) => node.dispatch("click");

global.document = {createElement: (tag) => new Node(tag)};
global.window = {};
require("../gnps_dashboard.js");
require("../scientific_names.js");
require("../ms_compare.js");
const compare = window.MSCompare;
const taxaById = new Map([[101, [101, "a", "Quercus robur", "L.", "species", null]],
  [202, [202, "b", "Picea abies", "(L.) H.Karst.", "species", null]]]);
const row = (id, sample, taxon) => [id, sample, "project", "Field name", null, null, null, taxon, "accepted_exact", null];
const profile = (id, field, name, instrument = 7, status = "OK") => [id, field, instrument, status, name];
const base = "https://emi-collection.unifr.ch/directus";
function fixture() {
  const rowsById = new Map([[10, row(10, "dbgi_oak", 101)], [20, row(20, "dbgi_spruce", 202)]]);
  const index = {rowsById, instruments: new Map([[7, {id: 7, code: "Q7", model: "Orbitrap"}],
    [8, {id: 8, code: "Q8", model: "QExactive"}]]), byField: new Map([
    [10, [profile(1, 10, "first.mzML"), profile(2, 10, "second.mzML")]],
    [20, [profile(3, 20, "third.mzML", 8)]]])};
  return {index, rowsById, taxaById, directusBase: base};
}
function reset() {
  const root = new Node("section");
  compare.render(root, fixture());
  click(cls(root, "ms-compare-clear"));
}
function overlay(root) { return new URL(root.findAll("iframe")[0].src).searchParams; }

test("three Directus IDs from unrelated species produce one BPI overlay and individual provenance", () => {
  reset();
  const options = fixture();
  assert.equal(compare.hasField(10, options.index), true);
  assert.equal(compare.addField(10, options.index), 2);
  const italicized = new Node("section");
  compare.render(italicized, options);
  assert.equal(italicized.findAll("i").some((name) => name.textContent === "Quercus robur"), true);
  assert.equal(compare.addField(10, options.index), 0);
  assert.equal(compare.addField(20, options.index), 1);
  assert.equal(compare.selectionCount(), 3);
  const root = new Node("section");
  compare.render(root, options);
  assert.match(cls(root, "ms-compare-selected").textContent, /Quercus robur.*Picea abies/);
  assert.equal(cls(root, "ms-compare-selected").findAll("li").length, 3);
  assert.deepEqual(overlay(root).get("usi").split("\n"), ["first", "second", "third"].map((name) =>
    `mzspec:MSV000102993:${name}.mzML`));
  assert.equal(overlay(root).get("tic_option"), "BPI");
  assert.equal(overlay(root).get("tic_overlay"), "1");
  const links = cls(root, "ms-compare-selected").findAll("a");
  assert.ok(links.some((link) => link.href === `${base}/admin/content/MS_Data/3`));
  assert.ok(links.some((link) => link.href === "#sample/20"));
  assert.ok(links.every((link) => !link.href.startsWith("https:") ||
    (link.target === "_blank" && link.rel === "noopener noreferrer")));
  click(buttons(root, "Remove MS_Data #2")[0]);
  assert.equal(compare.selectionCount(), 2);
  assert.deepEqual(overlay(root).get("usi").split("\n"),
    ["first", "third"].map((name) => `mzspec:MSV000102993:${name}.mzML`));
  compare.render(new Node("section"), options);
  assert.equal(compare.selectionCount(), 2, "selection survives SPA navigation");
  click(cls(root, "ms-compare-clear"));
  assert.equal(compare.selectionCount(), 0);
  assert.equal(root.findAll("iframe").length, 0);
});

test("unsafe filenames, foreign fields and missing snapshots cannot be selected; filename never identifies a file", () => {
  reset();
  const options = fixture();
  options.index.byField.get(10).push(profile(4, 10, "unsafe.raw"), profile(5, 10, "../unsafe"),
    profile(6, 10, "foreign.mzML", 99), profile(7, 10, "unpublished.mzML", 7, "failed"),
    profile(8, 20, "wrong-field.mzML"), profile(9, 10, "first.mzML"));
  options.index.byField.set(90, [profile(90, 90, "orphan.mzML")]);
  options.index.byField.set(91, [profile(91, 91, "different.mzML")]);
  options.index.rowsById.set(91, row(92, "spoofed", 101));
  assert.equal(compare.hasField(90, options.index), false);
  assert.equal(compare.hasField(91, options.index), false);
  assert.equal(compare.addField(90, options.index), 0);
  assert.equal(compare.addField(10, options.index), 3);
  const root = new Node("section");
  compare.render(root, {...options, rowsById: new Map([[10, row(10, "spoofed", 202)]])});
  assert.equal(compare.selectionCount(), 3);
  assert.doesNotMatch(root.textContent, /spoofed|unsafe.raw|\.\.\/unsafe|foreign.mzML|wrong-field.mzML/);
  assert.match(cls(root, "ms-compare-selected").textContent, /MS_Data #1.*MS_Data #9/);
  assert.equal(overlay(root).get("usi").split("\n").length, 3, "same filename never collapses different Directus IDs");
  click(buttons(root, "Remove MS_Data #1")[0]);
  assert.equal(compare.selectionCount(), 2, "same-name MS_Data #9 remains selected by ID");
  assert.match(cls(root, "ms-compare-selected").textContent, /MS_Data #9/);
  click(cls(root, "ms-compare-clear"));
});

test("search spans samples, taxon names, filename, instrument and numeric field ID, with paged results", () => {
  reset();
  const options = fixture();
  for (let id = 100; id < 205; id++) {
    options.rowsById.set(id, row(id, `dbgi_${id}`, id % 2 ? 101 : 202));
    options.index.byField.set(id, [profile(id + 1000, id, `file_${id}`, id % 2 ? 7 : 8)]);
  }
  const root = new Node("section");
  compare.render(root, options);
  const list = cls(root, "ms-compare-results");
  const search = root.findAll("input").find((node) => node.type === "search");
  assert.equal(list.findAll("li").length, 40);
  assert.match(cls(root, "ms-compare-results-status").textContent, /108 usable files/);
  click(buttons(root, "Next")[0]);
  assert.equal(list.findAll("li").length, 40);
  click(buttons(root, "Next")[0]);
  assert.equal(list.findAll("li").length, 28);
  search.value = "dbgi_103";
  search.dispatch("input");
  assert.equal(list.findAll("li").length, 1);
  assert.match(list.textContent, /file_103.mzML/);
  assert.equal(buttons(root, "Next")[0].disabled, true);
  for (const query of ["Quercus robur", "file_104", "QExactive", "105"]) {
    search.value = query;
    search.dispatch("input");
    assert.ok(list.findAll("li").length > 0, query);
  }
  search.value = "dbgi_103";
  search.dispatch("input");
  click(buttons(root, "Add MS_Data #1103")[0]);
  assert.equal(compare.selectionCount(), 1);
  assert.match(cls(root, "ms-compare-selected").textContent, /file_103.mzML/);
  click(cls(root, "ms-compare-clear"));
});

test("selections have no arbitrary upper cap and stale IDs are pruned when Directus snapshots change", () => {
  reset();
  const options = fixture();
  for (let id = 100; id < 225; id++) {
    options.rowsById.set(id, row(id, `dbgi_${id}`, 101));
    options.index.byField.set(id, [profile(id + 1000, id, `file_${id}`)]);
    assert.equal(compare.addField(id, options.index), 1);
  }
  assert.equal(compare.selectionCount(), 125);
  const root = new Node("section");
  compare.render(root, options);
  assert.equal(cls(root, "ms-compare-selected").findAll("li").length, 125);
  assert.equal(overlay(root).get("usi").split("\n").length, 125);
  options.index.byField.delete(224);
  compare.render(root, options);
  assert.equal(compare.selectionCount(), 124);
  click(cls(root, "ms-compare-clear"));
});
