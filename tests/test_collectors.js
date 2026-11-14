"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.style = {}; this.listeners = {}; }
  set textContent(value) { this.replaceChildren(String(value)); }
  get textContent() { return this.children.map(child => child instanceof Node ? child.textContent : child).join(""); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  click() { if (!this.disabled) this.listeners.click?.(); }
  findAll(tag) {
    return [...(this.tag === tag ? [this] : []),
      ...this.children.flatMap(child => child instanceof Node ? child.findAll(tag) : [])];
  }
  byClass(name) {
    return [...(this.className?.split(" ").includes(name) ? [this] : []),
      ...this.children.flatMap(child => child instanceof Node ? child.byClass(name) : [])];
  }
}
global.Element = Node;
global.document = {createElement: tag => new Node(tag)};
global.window = {};
require("../collector_map.js");
require("../collectors.js");
const {create} = window.DBGICollectors;
const base = "https://example.test/directus";
const ids = Array.from({length: 82}, (_, index) => index + 1);
const byId = new Map(ids.map(id => [id, [id, `Sample ${id}`, "Garden", "Taxon", null, null, "2026-01-01", 3, null]]));
const taxa = new Map([
  [3, [3, "COL-3", "Coffea arabica", "L.", "species", null]],
  [4, [4, "COL-4", "Coffea arabica subsp. arabica", null, "subspecies", 3]],
  [5, [5, "COL-5", "Coffea canephora", null, "species", null]],
  [6, [6, "COL-6", "Coffea", null, "genus", null]],
]);
function resolveSpecies(id) {
  for (let taxon = taxa.get(id); taxon; taxon = taxa.get(taxon[5])) {
    if (taxon[4] === "species") return taxon;
  }
  return null;
}
function scientific(parent, taxon) { parent.append(taxon[2]); }
function fixture(collectors = [
  {id: 11, name: "Same name", field_ids: ids.slice(0, 81)},
  {id: 12, name: "Same name", field_ids: [82]},
]) {
  return {
    source: base, generated_at: "2026-11-14T10:00:00Z",
    sample_snapshot_generated_at: "2026-11-13T10:00:00Z", total_field_rows: 100,
    unlinked_named_samples: 2, collectors,
  };
}
function ui(snapshot = fixture(), samples = byId, resolve = resolveSpecies) {
  const leaderboardRoot = new Node("main");
  const detailRoot = new Node("main");
  return {leaderboardRoot, detailRoot,
    view: create({leaderboardRoot, detailRoot, snapshot, byId: samples, directusBase: base,
      resolveSpecies: resolve, renderScientificTaxon: scientific, loadLeaflet: () => Promise.resolve()})};
}

test("ranks distinct People identities and links only linked sample IDs", () => {
  const {view, leaderboardRoot, detailRoot} = ui();
  view.leaderboard();
  const cards = leaderboardRoot.byClass("collectors__card");
  assert.deepEqual(cards.map(card => card.href), ["#collector/11", "#collector/12"]);
  assert.deepEqual(cards.map(card => card.byClass("collectors__bar")[0].style.width), ["100%", `${100 / 81}%`]);
  assert.match(leaderboardRoot.textContent, /2 samples have a recorded collector name but no People link and are excluded/);
  assert.equal(view.detail(12), true);
  assert.deepEqual(detailRoot.byClass("collectors__species-link").map(link => link.href), ["#species/3"]);
  detailRoot.byClass("collectors__tab--samples")[0].click();
  assert.deepEqual(detailRoot.byClass("collectors__sample-link").map(link => link.href), ["#sample/82"]);
  assert.equal(detailRoot.byClass("collectors__sample-source")[0].href, `${base}/admin/content/Field_Data/82`);
  assert.equal(detailRoot.byClass("collectors__source")[0].href, `${base}/admin/content/People/12`);
});

test("verified Directus identities and DBGI team links appear on a collector card and detail without nesting links", () => {
  const profile = {id: 25, name: "Mazzarine Laboureau", field_ids: [1],
    orcid: "0009-0006-7011-4195", inat: "mazzarinel",
    dbgi_profile: "https://www.dbgi.org/team/laboureau-mazzarine/",
    portrait: "assets/collectors/25.webp"};
  const {view, leaderboardRoot, detailRoot} = ui(fixture([profile]));
  view.leaderboard();
  const card = leaderboardRoot.byClass("collectors__card")[0];
  assert.equal(card.href, "#collector/25");
  assert.equal(card.findAll("a").length, 1);
  assert.equal(card.findAll("img")[0].src, "assets/collectors/25.webp");
  const external = leaderboardRoot.byClass("collectors__profile-links")[0].findAll("a");
  assert.deepEqual(external.map(link => link.href),
    [profile.dbgi_profile, "https://orcid.org/0009-0006-7011-4195",
      "https://www.inaturalist.org/people/mazzarinel"]);
  assert.equal(external.every(link => link.rel === "noopener noreferrer" && link.target === "_blank"), true);
  view.detail(25);
  assert.deepEqual(detailRoot.byClass("collectors__profile-links")[0].findAll("a").map(link => link.href),
    external.map(link => link.href));
  assert.equal(detailRoot.byClass("collectors__person-header")[0].findAll("img")[0].src,
    "assets/collectors/25.webp");
  const {view: plainView, leaderboardRoot: plainRoot} = ui(fixture([
    {id: 25, name: "No verified profile", field_ids: [1]}]));
  plainView.leaderboard();
  assert.equal(plainRoot.byClass("collectors__profile-links").length, 0);
  assert.equal(plainRoot.findAll("img").length, 0);
  assert.match(plainRoot.byClass("collectors__portrait")[0].textContent, /NP/);
  const {view: unsafeView, leaderboardRoot: unsafeRoot} = ui(fixture([
    {...profile, portrait: "https://untrusted.test/face.jpg"}]));
  unsafeView.leaderboard();
  assert.match(unsafeRoot.textContent, /unavailable/);
});

test("paginates all linked samples with complete first and last pages", () => {
  const {view, detailRoot} = ui();
  assert.equal(view.detail(11), true);
  detailRoot.byClass("collectors__tab--samples")[0].click();
  const links = () => detailRoot.byClass("collectors__sample-link").map(link => link.href);
  const [previous, next] = detailRoot.byClass("collectors__samples-panel")[0].findAll("button");
  assert.deepEqual(links(), ids.slice(0, 40).map(id => `#sample/${id}`));
  assert.equal(previous.disabled, true);
  next.click();
  assert.deepEqual(links(), ids.slice(40, 80).map(id => `#sample/${id}`));
  next.click();
  assert.deepEqual(links(), ["#sample/81"]);
  assert.equal(next.disabled, true);
  assert.match(detailRoot.textContent, /Page 3 of 3/);
  previous.click();
  assert.deepEqual(links(), ids.slice(40, 80).map(id => `#sample/${id}`));
});

test("groups only this collector's species by Taxa ancestry and drills into matching samples", () => {
  const samples = new Map(byId);
  for (const [id, taxon] of [[1, 3], [2, 4], [3, 5], [4, 6], [5, 3]]) {
    samples.set(id, [...byId.get(id).slice(0, 7), taxon, null]);
  }
  const {view, detailRoot} = ui(fixture([{id: 11, name: "Collector", field_ids: [1, 2, 3, 4]}]), samples);
  assert.equal(view.detail(11), true);
  assert.deepEqual(detailRoot.byClass("collectors__species-link").map(link => link.href),
    ["#species/3", "#species/5"]);
  assert.deepEqual(detailRoot.byClass("collectors__species-count").map(item => item.textContent),
    ["2 samples", "1 sample"]);
  assert.match(detailRoot.byClass("collectors__species-panel")[0].textContent,
    /1 samples lack a resolved species/);
  detailRoot.byClass("collectors__species-samples")[0].click();
  assert.deepEqual(detailRoot.byClass("collectors__sample-link").map(link => link.href),
    ["#sample/1", "#sample/2"]);
  detailRoot.byClass("collectors__clear-filter")[0].click();
  assert.deepEqual(detailRoot.byClass("collectors__sample-link").map(link => link.href),
    ["#sample/1", "#sample/2", "#sample/3", "#sample/4"]);
  detailRoot.byClass("collectors__tab--map")[0].click();
  assert.equal(detailRoot.byClass("collectors__samples-panel")[0].hidden, true);
  assert.equal(detailRoot.byClass("collectors__map-panel")[0].hidden, false);
  detailRoot.byClass("collectors__tab--species")[0].click();
  assert.equal(detailRoot.byClass("collectors__species-panel")[0].hidden, false);
  view.hide();
});

test("species list pages every distinct Taxa species without dropping the last page", () => {
  const samples = new Map(byId);
  const species = new Map();
  for (let id = 1; id <= 30; id++) {
    const taxonId = 100 + id;
    species.set(taxonId, [taxonId, `COL-${taxonId}`, `Species ${id}`, null, "species", null]);
    samples.set(id, [...byId.get(id).slice(0, 7), taxonId, null]);
  }
  const {view, detailRoot} = ui(
    fixture([{id: 11, name: "Collector", field_ids: ids.slice(0, 30)}]),
    samples, id => species.get(id) || null);
  assert.equal(view.detail(11), true);
  const panel = detailRoot.byClass("collectors__species-panel")[0];
  assert.equal(panel.byClass("collectors__species-link").length, 25);
  const [previous, next] = panel.findAll("button").slice(-2);
  assert.equal(previous.disabled, true);
  next.click();
  assert.equal(panel.byClass("collectors__species-link").length, 5);
  assert.equal(next.disabled, true);
  assert.match(panel.textContent, /Page 2 of 2/);
  previous.click();
  assert.equal(panel.byClass("collectors__species-link").length, 25);
});

test("leaderboard filters all linked identities and sorts numeric counts and People IDs", () => {
  const {view, leaderboardRoot} = ui(fixture([
    {id: 25, name: "Zed", field_ids: ids.slice(0, 10)},
    {id: 3, name: "Amy", field_ids: ids.slice(10, 12)},
    {id: 11, name: "Bee", field_ids: ids.slice(12, 13)},
  ]));
  view.leaderboard();
  const links = () => leaderboardRoot.byClass("collectors__card").map(card => card.href);
  const search = leaderboardRoot.findAll("input")[0];
  const sort = leaderboardRoot.findAll("select")[0];
  assert.deepEqual(links(), ["#collector/25", "#collector/3", "#collector/11"]);
  sort.value = "count-asc";
  sort.listeners.change();
  assert.deepEqual(links(), ["#collector/11", "#collector/3", "#collector/25"]);
  sort.value = "id-desc";
  sort.listeners.change();
  assert.deepEqual(links(), ["#collector/25", "#collector/11", "#collector/3"]);
  search.value = "amy";
  search.listeners.input();
  assert.deepEqual(links(), ["#collector/3"]);
  assert.equal(search.value, "amy");
  search.value = "10";
  search.listeners.input();
  assert.deepEqual(links(), ["#collector/25"]);
});

test("species filters the full list before paging and keeps drill-down scoped", () => {
  const samples = new Map(byId);
  const species = new Map();
  for (let id = 1; id <= 30; id++) {
    const taxonId = 100 + id;
    species.set(taxonId, [taxonId, `COL-${taxonId}`, `Species ${id}`, null, "species", null]);
    samples.set(id, [...byId.get(id).slice(0, 7), taxonId, null]);
  }
  samples.set(31, [...byId.get(31).slice(0, 7), 130, null]);
  const {view, detailRoot} = ui(
    fixture([{id: 11, name: "Collector", field_ids: ids.slice(0, 31)}]),
    samples, id => species.get(id) || null);
  view.detail(11);
  const panel = detailRoot.byClass("collectors__species-panel")[0];
  const links = () => panel.byClass("collectors__species-link").map(link => link.href);
  const search = panel.findAll("input")[0];
  const sort = panel.findAll("select")[0];
  assert.equal(links()[0], "#species/130");
  sort.value = "name-desc";
  sort.listeners.change();
  assert.equal(links()[0], "#species/109");
  sort.value = "count-desc";
  sort.listeners.change();
  panel.findAll("button").slice(-1)[0].click();
  search.value = "Species 30";
  search.listeners.input();
  assert.deepEqual(links(), ["#species/130"]);
  assert.match(panel.textContent, /Page 1 of 1/);
  assert.equal(search.value, "Species 30");
  sort.value = "count-asc";
  sort.listeners.change();
  assert.deepEqual(links(), ["#species/130"]);
  panel.byClass("collectors__species-samples")[0].click();
  assert.deepEqual(detailRoot.byClass("collectors__sample-link").map(link => link.href),
    ["#sample/30", "#sample/31"]);
});

test("sample search and sorting precede pagination and respect collector and species scopes", () => {
  const samples = new Map(byId);
  samples.set(81, [81, "Rare specimen", "Rare project", "Special field", null, null, "2025-03-01", 5, null]);
  const {view, detailRoot} = ui(fixture(), samples);
  view.detail(11);
  detailRoot.byClass("collectors__tab--samples")[0].click();
  const panel = detailRoot.byClass("collectors__samples-panel")[0];
  const links = () => panel.byClass("collectors__sample-link").map(link => link.href);
  const search = panel.findAll("input")[0];
  const sort = panel.findAll("select")[0];
  const next = panel.byClass("collectors__pager")[0].findAll("button")[1];
  next.click();
  search.value = "Special field";
  search.listeners.input();
  assert.deepEqual(links(), ["#sample/81"]);
  assert.match(panel.textContent, /Page 1 of 1/);
  search.value = "Rare project";
  search.listeners.input();
  assert.deepEqual(links(), ["#sample/81"]);
  search.value = "";
  search.listeners.input();
  sort.value = "id-desc";
  sort.listeners.change();
  assert.deepEqual(links(), ids.slice(0, 81).reverse().slice(0, 40).map(id => `#sample/${id}`));
  sort.value = "name-asc";
  sort.listeners.change();
  assert.equal(links()[0], "#sample/81");
  sort.value = "project-desc";
  sort.listeners.change();
  assert.equal(links()[0], "#sample/81");
  sort.value = "field-asc";
  sort.listeners.change();
  assert.equal(links()[0], "#sample/81");
  sort.value = "date-asc";
  sort.listeners.change();
  assert.equal(links()[0], "#sample/81");
  assert.equal(search.value, "");
  detailRoot.byClass("collectors__tab--species")[0].click();
  detailRoot.byClass("collectors__species-samples")[0].click();
  search.value = "82";
  search.listeners.input();
  assert.deepEqual(links(), []);
  assert.match(panel.textContent, /0 samples/);
  detailRoot.byClass("collectors__clear-filter")[0].click();
  assert.deepEqual(links(), []);
});

test("rejects mismatched, duplicate, and unpublished Field_Data without rendering attributions", () => {
  const cases = [
    fixture([{id: 11, name: "A", field_ids: [1, 1]}]),
    fixture([{id: 11, name: "A", field_ids: [1]}, {id: 12, name: "B", field_ids: [1]}]),
    fixture([{id: 11, name: "A", field_ids: [999]}]),
    fixture([{id: 11, name: "A", field_ids: [1]}, {id: 11, name: "B", field_ids: [2]}]),
    {...fixture(), source: "https://other.test/items/"},
  ];
  for (const snapshot of cases) {
    const {view, leaderboardRoot, detailRoot} = ui(snapshot);
    view.leaderboard();
    assert.equal(leaderboardRoot.findAll("a").length, 0);
    assert.match(leaderboardRoot.textContent, /unavailable/);
    assert.equal(view.detail(11), false);
    assert.equal(detailRoot.findAll("a").length, 0);
  }
  const tampered = new Map(byId);
  tampered.set(1, [1000, "Sample 1", "Garden", "Taxon", null, null, null, null, null]);
  const {view} = ui(fixture(), tampered);
  assert.equal(view.detail(11), false);
});

test("unknown People IDs and hostile text are handled without HTML parsing", () => {
  const {view, detailRoot} = ui(fixture([{id: 8, name: "<img src=x>", field_ids: [1]}]));
  assert.equal(view.detail(8), true);
  assert.equal(detailRoot.findAll("img").length, 0);
  assert.match(detailRoot.textContent, /<img src=x>/);
  assert.equal(view.detail(100), false);
  assert.match(detailRoot.textContent, /Collector not found/);
});
