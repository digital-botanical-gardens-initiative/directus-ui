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
require("../assets/js/gnps_dashboard.js");
require("../assets/js/scientific_names.js");
require("../assets/js/ms_profile.js");
require("../assets/js/metabolome.js");
require("../assets/js/chemcalc.js");
require("../assets/js/ms_compare.js");
const compare = window.MSCompare;
const taxaById = new Map([[101, [101, "a", "Quercus robur", "L.", "species", null]],
  [202, [202, "b", "Picea abies", "(L.) H.Karst.", "species", null]]]);
const row = (id, sample, taxon) => [id, sample, "project", "Field name", null, null, null, taxon, "accepted_exact", null];
const profile = (id, field, name, instrument = 7, status = "OK", methodId = null) =>
  [id, field, instrument, status, name, methodId];
const base = "https://emi-collection.unifr.ch/directus";
function fixture() {
  const rowsById = new Map([[10, row(10, "dbgi_oak", 101)], [20, row(20, "dbgi_spruce", 202)]]);
  const index = {rowsById, instruments: new Map([[7, {id: 7, code: "Q7", model: "Orbitrap"}],
    [8, {id: 8, code: "Q8", model: "QExactive"}]]),
    injectionMethods: new Map([[10, "positive"], [11, "negative"], [12, null]]),
    byField: new Map([
    [10, [profile(1, 10, "first.mzML", 7, "OK", 10),
      profile(2, 10, "second.mzML", 7, "OK", 11)]],
    [20, [profile(3, 20, "third.mzML", 8, "OK", 12)]]])};
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
  assert.deepEqual(compare.filesForField(10, options.index).map((entry) => entry[0]), [1, 2]);
  assert.equal(compare.selectFile(10, 1, options.index), true);
  const italicized = new Node("section");
  compare.render(italicized, options);
  assert.equal(italicized.findAll("i").some((name) => name.textContent === "Quercus robur"), true);
  assert.deepEqual(italicized.findAll("span").filter((span) => span.className?.startsWith("ms-polarity-badge"))
    .map((span) => span.textContent), ["+"]);
  assert.equal(compare.selectFile(10, 2, options.index), true);
  assert.equal(compare.selectFile(20, 3, options.index), true);
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
  assert.deepEqual(compare.filesForField(90, options.index), []);
  assert.deepEqual(compare.filesForField(91, options.index), []);
  for (const invalid of [4, 5, 6, 7, 8, 90]) assert.equal(compare.selectFile(10, invalid, options.index), false);
  for (const valid of [1, 2, 9]) assert.equal(compare.selectFile(10, valid, options.index), true);
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

test("files appear only after submitted search; full-match pagination and multi-field lookup still work", () => {
  reset();
  const options = fixture();
  for (let id = 100; id < 205; id++) {
    options.rowsById.set(id, row(id, `dbgi_${id}`, id % 2 ? 101 : 202));
    options.index.byField.set(id, [profile(id + 1000, id, `file_${id}`, id % 2 ? 7 : 8)]);
  }
  const root = new Node("section");
  compare.render(root, options);
  const list = cls(root, "ms-compare-results");
  const pages = cls(root, "ms-compare-pages");
  const search = root.findAll("input").find((node) => node.type === "search");
  const form = cls(root, "ms-compare-search-form");
  assert.equal(list.hidden, true);
  assert.equal(pages.hidden, true);
  assert.equal(list.findAll("li").length, 0);
  assert.doesNotMatch(cls(root, "ms-compare-results-status").textContent, /108 usable files/);
  form.dispatch("submit");
  assert.equal(list.hidden, true, "blank submission never exposes all files");
  search.value = "dbgi_";
  search.dispatch("input");
  assert.equal(list.hidden, true, "typing alone does not launch the search");
  form.dispatch("submit");
  assert.equal(list.hidden, false);
  assert.equal(list.findAll("li").length, 40);
  assert.match(cls(root, "ms-compare-results-status").textContent, /108 usable files/);
  click(buttons(root, "Next")[0]);
  assert.equal(list.findAll("li").length, 40);
  click(buttons(root, "Next")[0]);
  assert.equal(list.findAll("li").length, 28);
  search.value = "dbgi_103";
  search.dispatch("input");
  assert.equal(list.hidden, true, "editing the query hides stale results");
  form.dispatch("submit");
  assert.equal(list.findAll("li").length, 1);
  assert.match(list.textContent, /file_103.mzML/);
  assert.equal(buttons(root, "Next")[0].disabled, true);
  for (const query of ["Quercus robur", "file_104", "QExactive", "105"]) {
    search.value = query;
    search.dispatch("input");
    form.dispatch("submit");
    assert.ok(list.findAll("li").length > 0, query);
  }
  search.value = "dbgi_103";
  search.dispatch("input");
  form.dispatch("submit");
  click(buttons(root, "Add MS_Data #1103")[0]);
  assert.equal(compare.selectionCount(), 1);
  assert.match(cls(root, "ms-compare-selected").textContent, /file_103.mzML/);
  click(cls(root, "ms-compare-clear"));
});

test("independent GNPS2 stacks keep exact Directus IDs in group A and newline-separated group B", () => {
  reset();
  const options = fixture();
  const root = new Node("section");
  compare.render(root, options);
  const search = root.findAll("input").find((node) => node.type === "search");
  const form = cls(root, "ms-compare-search-form");
  search.value = "dbgi_oak";
  form.dispatch("submit");
  click(buttons(root, "Add MS_Data #1 to group A")[0]);
  click(buttons(root, "Add MS_Data #2 to group B")[0]);
  let params = overlay(root);
  assert.equal(params.get("usi"), "mzspec:MSV000102993:first.mzML");
  assert.equal(params.get("usi2"), "mzspec:MSV000102993:second.mzML");
  assert.equal(JSON.parse(decodeURIComponent(root.findAll("iframe")[0].src.split("#")[1])).usi2, params.get("usi2"));
  assert.match(cls(root, "ms-compare-status").textContent, /Group A: 1 · Group B: 1/);
  search.value = "dbgi_spruce";
  search.dispatch("input");
  form.dispatch("submit");
  click(buttons(root, "Add MS_Data #3 to group B")[0]);
  params = overlay(root);
  assert.equal(params.get("usi2"), "mzspec:MSV000102993:second.mzML\nmzspec:MSV000102993:third.mzML");
  assert.equal(params.get("tic_overlay"), "1", "within-group BPI overlay is requested");
  const groupA = cls(root, "ms-compare-selected").findAll("select")[0];
  groupA.value = "B"; groupA.dispatch("change");
  assert.equal(root.findAll("iframe").length, 0, "GNPS is not given a fabricated primary group");
  assert.match(cls(root, "ms-compare-status").textContent, /Add a file to group A/);
  compare.render(root, options);
  assert.match(cls(root, "ms-compare-status").textContent, /Group A: 0 · Group B: 3/);
  const moved = cls(root, "ms-compare-selected").findAll("select")[0];
  moved.value = "A"; moved.dispatch("change");
  assert.equal(overlay(root).get("usi2").split("\n").length, 2);
  assert.equal(root.findAll("iframe").length, 1);
  click(cls(root, "ms-compare-clear"));
  assert.equal(compare.selectionCount(), 0);
});

test("choosing one MS analysis never adds another positive/negative file from the same field sample", () => {
  reset();
  const options = fixture();
  assert.equal(compare.selectFile(10, 1, options.index), true);
  assert.equal(compare.isSelected(1), true);
  assert.equal(compare.isSelected(2), false, "second file of this same sample is not auto-added");
  assert.equal(compare.selectFile(20, 3, options.index), true);
  assert.equal(compare.removeFile(10, 1, options.index), true);
  assert.equal(compare.isSelected(1), false);
  assert.equal(compare.isSelected(3), true);
  const root = new Node("section");
  compare.render(root, options);
  assert.equal(new URL(root.findAll("iframe")[0].src).searchParams.get("usi"),
    "mzspec:MSV000102993:third.mzML");
  click(cls(root, "ms-compare-clear"));
});

test("selections have no arbitrary upper cap and stale IDs are pruned when Directus snapshots change", () => {
  reset();
  const options = fixture();
  for (let id = 100; id < 225; id++) {
    options.rowsById.set(id, row(id, `dbgi_${id}`, 101));
    options.index.byField.set(id, [profile(id + 1000, id, `file_${id}`)]);
    assert.equal(compare.selectFile(id, id + 1000, options.index), true);
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

test("LOTUS search distinguishes selected species, an unscoped search and missing Wikidata IDs", () => {
  reset();
  const options = fixture();
  const root = new Node("section");
  compare.render(root, {...options, mapping: {rows: [["a", "Q123"], ["b", "Q456"]]}});
  const lotus = cls(root, "ms-compare-lotus");
  const launch = cls(root, "ms-compare-lotus-form");
  assert.equal(lotus.findAll("iframe").length, 0, "third-party LOTUS does not load until requested");
  assert.equal(cls(root, "ms-compare-calculator").hidden, true);
  launch.dispatch("submit");
  assert.equal(lotus.findAll("iframe")[0].src, "https://lotus-initiative.github.io/lotus-explore-rs/search/");
  assert.equal(compare.selectFile(10, 1, options.index), true);
  compare.render(root, {...options, mapping: {rows: [["a", "Q123"], ["b", "Q456"]]}});
  const speciesScope = cls(root, "ms-compare-lotus-form").findAll("select")[0];
  assert.equal(speciesScope.value, "101", "one selected species is offered as the default scope");
  assert.equal(cls(root, "ms-compare-lotus").findAll("iframe").length, 0);
  cls(root, "ms-compare-lotus-form").dispatch("submit");
  assert.equal(cls(root, "ms-compare-lotus").findAll("iframe")[0].src,
    "https://lotus-initiative.github.io/lotus-explore-rs/search/?taxon=Q123&execute=true");
  assert.match(cls(root, "ms-compare-lotus").textContent, /not measurements of the selected MS files/);
  assert.equal(compare.selectFile(20, 3, options.index), true);
  compare.render(root, {...options, mapping: {rows: [["a", "Q123"], ["b", "Q456"]]}});
  const choices = cls(root, "ms-compare-lotus-form").findAll("select")[0];
  assert.deepEqual(choices.findAll("option").map((option) => option.textContent),
    ["Unscoped LOTUS search", "Picea abies (L.) H.Karst.", "Quercus robur L."]);
  choices.value = "202"; choices.dispatch("change");
  assert.equal(cls(root, "ms-compare-lotus").findAll("iframe").length, 0, "changing species unloads the stale search");
  cls(root, "ms-compare-lotus-form").dispatch("submit");
  assert.equal(cls(root, "ms-compare-lotus").findAll("iframe")[0].src,
    "https://lotus-initiative.github.io/lotus-explore-rs/search/?taxon=Q456&execute=true");
  compare.updateMapping({rows: [["a", "Q123"], ["b", "Q789"]]});
  assert.equal(cls(root, "ms-compare-lotus").findAll("iframe")[0].src,
    "https://lotus-initiative.github.io/lotus-explore-rs/search/?taxon=Q789&execute=true");
  choices.value = "manual"; choices.dispatch("change");
  cls(root, "ms-compare-lotus-form").dispatch("submit");
  assert.equal(cls(root, "ms-compare-lotus").findAll("iframe")[0].src,
    "https://lotus-initiative.github.io/lotus-explore-rs/search/");
  click(cls(root, "ms-compare-clear"));
  assert.equal(cls(root, "ms-compare-calculator").hidden, true);
});

test("unmapped selected species uses a verified Directus genus, not another species QID", () => {
  reset();
  const options = fixture();
  options.taxaById = new Map(options.taxaById);
  options.taxaById.set(101, [101, "a", "Quercus robur", "L.", "species", 99]);
  options.taxaById.set(99, [99, "GENUS", "Quercus", null, "genus", null]);
  compare.selectFile(10, 1, options.index);
  const root = new Node("section");
  compare.render(root, {...options, mapping: {rows: [["b", "Q456"], ["a", "Q0"]]}});
  cls(root, "ms-compare-lotus-form").dispatch("submit");
  assert.equal(cls(root, "ms-compare-lotus").findAll("iframe")[0].src,
    "https://lotus-initiative.github.io/lotus-explore-rs/search/?taxon=Quercus&execute=true");
  assert.match(cls(root, "ms-compare-lotus").textContent, /Genus-level results can include other species/);
  click(cls(root, "ms-compare-clear"));
});

test("ChemCalc adduct and GNPS2 BPI/XIC operate on chosen analysis stacks without coupling third-party frames", () => {
  reset();
  const options = fixture();
  compare.selectFile(10, 1, options.index);
  const root = new Node("section");
  compare.render(root, options);
  const calc = cls(root, "ms-compare-calculator");
  assert.equal(calc.hidden, false);
  assert.equal(calc.findAll("iframe").length, 0, "formula stays local before Calculate is submitted");
  const formula = cls(calc, "chemcalc-form").findAll("input")[0];
  formula.value = "C8H10N4O2";
  cls(calc, "chemcalc-form").dispatch("submit");
  const chemUrl = new URL(calc.findAll("iframe")[0].src);
  assert.equal(chemUrl.searchParams.get("mf"), "C8H10N4O2");
  assert.equal(chemUrl.searchParams.get("ionizations"), "H+");
  const mass = cls(root, "gnps-mass-form").findAll("input")[0];
  mass.value = "195.08765";
  cls(root, "gnps-mass-form").dispatch("submit");
  const gnps = cls(root, "ms-compare-dashboard");
  assert.equal(new URL(gnps.findAll("iframe")[0].src).searchParams.get("xicmz"), "195.08765");
  compare.selectFile(20, 3, options.index);
  compare.render(root, options);
  assert.equal(new URL(cls(root, "ms-compare-dashboard").findAll("iframe")[0].src).searchParams.has("xicmz"), false,
    "revisiting the workspace does not silently reapply an old XIC");
  const secondGroup = cls(root, "ms-compare-selected").findAll("select")[1];
  secondGroup.value = "B"; secondGroup.dispatch("change");
  const compareMass = cls(root, "gnps-mass-form").findAll("input")[0];
  compareMass.value = "195.08765";
  cls(root, "gnps-mass-form").dispatch("submit");
  let url = new URL(cls(root, "ms-compare-dashboard").findAll("iframe")[0].src);
  assert.equal(url.searchParams.get("usi"), "mzspec:MSV000102993:first.mzML");
  assert.equal(url.searchParams.get("usi2"), "mzspec:MSV000102993:third.mzML");
  assert.equal(url.searchParams.get("xicmz"), "195.08765");
  assert.equal(url.searchParams.get("tic_option"), "BPI");
  click(buttons(root, "Remove MS_Data #3")[0]);
  url = new URL(cls(root, "ms-compare-dashboard").findAll("iframe")[0].src);
  assert.equal(url.searchParams.get("xicmz"), "195.08765", "valid XIC mass survives changing selected files");
  assert.equal(cls(root, "gnps-mass-form").findAll("input")[0].value, "195.08765");
  click(cls(root, "ms-compare-clear"));
  assert.equal(cls(root, "ms-compare-calculator").hidden, true);
  assert.equal(cls(root, "ms-compare-calculator").findAll("iframe").length, 0);
  assert.equal(cls(root, "ms-compare-dashboard").findAll("iframe").length, 0);
});
