"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

class Node {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attrs = {};
    this.listeners = {};
    this.value = "";
    this.checked = false;
  }
  set textContent(value) { this.value = String(value); this.replaceChildren(); }
  get textContent() { return this.value + this.children.map((child) => typeof child === "string" ? child : child.textContent).join(""); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(key, value) { this.attrs[key] = value; }
  removeAttribute(key) { delete this[key]; delete this.attrs[key]; }
  addEventListener(event, fn) { this.listeners[event] = fn; }
  findAll(tag) { return [...(this.tag === tag ? [this] : []), ...this.children.flatMap((child) => child instanceof Node ? child.findAll(tag) : [])]; }
}

global.document = {createElement: (tag) => new Node(tag)};
global.window = {};
require("../scientific_names.js");
require("../inaturalist.js");
const inat = global.window.INaturalist;
const columns = ["sample_id", "field_id", "observation_id", "observer_taxon_id", "observer_name", "observer_rank",
  "community_taxon_id", "community_name", "community_rank", "col_id", "col_name", "col_rank", "status", "reason", "photos"];
const agreement = ["dbgi_000037", 91, 110560140, 9, "Other name", "species", 206749, "Echeveria elegans", "species",
  "COL-7", "Echeveria elegans", "species", "agreement", "Same scientific name at the same rank",
  [["https://inaturalist-open-data.s3.amazonaws.com/photos/186526029/square.jpeg", "no rights reserved", "cc0"],
   ["https://inaturalist-open-data.s3.amazonaws.com/photos/186526034/square.jpeg", "© Second creator", "cc-by"],
   ["https://inaturalist-open-data.s3.amazonaws.com/photos/186526039/square.jpeg", null, null]]];
const disagreement = ["dbgi_000037", 91, 110560141, 9, "Other name", "species", 6, "Echeveria agavoides", "species",
  "COL-7", "Echeveria elegans", "species", "potential disagreement", "Different scientific names at the same rank",
  [["https://static.inaturalist.org/photos/187000000/square.jpg", null, null]]];
const unassessable = ["dbgi_000038", 92, 110561024, 9, "Leonurus cardiaca", "species", null, null, null,
  null, null, null, "unassessable", "No iNaturalist community taxon ID", []];
const data = {source: "https://emi-collection.unifr.ch/directus/items/Curation_Data", linked_samples: 2,
  columns, rows: [agreement, disagreement, unassessable]};

test("all Directus photos render as selectable galleries with per-photo attribution and image fallback", () => {
  const root = new Node("section");
  assert.equal(inat.renderSample(root, "dbgi_000037", data), 2);
  assert.equal(root.findAll("h3")[0].textContent, "iNaturalist observations");
  assert.equal(root.findAll("figure").length, 2);
  const figures = root.findAll("figure");
  const first = figures[0];
  const main = first.findAll("a")[0].findAll("img")[0];
  const thumbs = first.findAll("button");
  assert.equal(thumbs.length, 3);
  assert.equal(main.src, agreement[14][0][0].replace("/square.", "/large."));
  assert.equal(thumbs[0].attrs["aria-pressed"], "true");
  assert.equal(thumbs[1].attrs["aria-pressed"], "false");
  assert.equal(thumbs[1].findAll("img")[0].loading, "lazy");
  assert.match(first.textContent, /no rights reserved.*cc0/);
  main.listeners.error();
  assert.equal(main.src, agreement[14][0][0].replace("/square.", "/medium."));
  main.listeners.error();
  assert.equal(main.src, agreement[14][0][0]);
  thumbs[1].listeners.click();
  assert.equal(main.src, agreement[14][1][0].replace("/square.", "/large."));
  assert.equal(thumbs[1].attrs["aria-pressed"], "true");
  assert.match(main.alt, /photo 2 of 3/i);
  assert.match(first.textContent, /© Second creator.*cc-by/);
  thumbs[2].listeners.click();
  assert.doesNotMatch(first.textContent, /© Second creator|cc-by/);
  assert.equal(figures[1].findAll("button").length, 0);
  assert.equal(figures[1].findAll("img").length, 1);
  assert.equal(root.findAll("a").filter((anchor) => anchor.href ===
    "https://emi-collection.unifr.ch/directus/admin/content/Curation_Data/110560141").length, 1);
  assert.equal(first.findAll("a")[0].rel, "noopener noreferrer");
  assert.equal(inat.renderSample(root, "dbgi_000038", data), 1);
  assert.equal(root.findAll("img").length, 0);
  assert.match(root.textContent, /No observation photos available/);
  assert.match(root.textContent, /110561024/);
  assert.equal(inat.renderSample(root, "missing", data), 0);
  assert.match(root.textContent, /No linked/);
});

test("failed large and medium image loads fall back to square and then source link", () => {
  const root = new Node("section");
  inat.renderSample(root, "dbgi_000037", data);
  const figure = root.findAll("figure")[0];
  const img = figure.findAll("a")[0].findAll("img")[0];
  img.listeners.error();
  img.listeners.error();
  img.listeners.error();
  assert.equal(img.src, undefined);
  assert.equal(img.hidden, true);
  assert.match(figure.textContent, /Photo could not be loaded/);
  figure.findAll("button")[1].listeners.click();
  assert.equal(img.hidden, false);
  assert.equal(img.src, agreement[14][1][0].replace("/square.", "/large."));
});

test("review filters and selects locally without writing or network access", () => {
  const root = new Node("section");
  global.fetch = () => { throw new Error("No network requests should occur"); };
  inat.renderReview(root, data, {rows: [[91], [92]]});
  const search = root.findAll("input").find((item) => item.type === "search");
  const status = root.findAll("select")[0];
  assert.match(root.textContent, /1 potential disagreements · 1 agreements · 1 unassessable/);
  assert.equal(root.findAll("tbody")[0].findAll("tr").length, 1);
  const selected = root.findAll("input").find((item) => item.type === "checkbox");
  selected.checked = true;
  selected.listeners.change();
  assert.match(root.textContent, /1 selected for review \(local only\)/);
  status.value = "all";
  status.listeners.change();
  assert.equal(root.findAll("tbody")[0].findAll("tr").length, 3);
  const chosen = root.findAll("tbody")[0].findAll("tr").find((row) =>
    row.findAll("a").some((anchor) => anchor.href === "https://www.inaturalist.org/observations/110560141"));
  assert.equal(chosen.findAll("input")[0].checked, true);
  assert.equal(root.findAll("a").find((item) => item.href === "#sample/91").textContent, "dbgi_000037");
  search.value = "110561024";
  search.listeners.input();
  assert.equal(root.findAll("tbody")[0].findAll("tr").length, 1);
  assert.match(root.textContent, /1 selected for review/);
  status.value = "agreement";
  status.listeners.change();
  assert.equal(root.findAll("tbody")[0].findAll("tr").length, 0);
});

test("unavailable and empty snapshots are displayed without ghost observations", () => {
  const root = new Node("section");
  assert.equal(inat.renderSample(root, "dbgi_000037", null), 0);
  assert.match(root.textContent, /unavailable/);
  inat.renderReview(root, null, null);
  assert.match(root.textContent, /unavailable/);
  inat.renderReview(root, {columns, rows: [], linked_samples: 0}, {rows: []});
  assert.match(root.textContent, /0 linked observations across 0 samples/);
  assert.equal(root.findAll("tbody")[0].findAll("tr").length, 0);
});

test("scientific names italicize epithets but not rank markers, authorship, or family names", () => {
  const trinomial = new Node("p");
  global.window.DBGIScientificNames.append(trinomial, "Zea mays subsp. mays", "subspecies", "L.");
  assert.deepEqual(trinomial.findAll("i").map((child) => child.textContent), ["Zea mays", "mays"]);
  assert.equal(trinomial.textContent, "Zea mays subsp. mays L.");
  assert.equal(trinomial.children[1], " subsp. ");
  assert.equal(trinomial.children[3], " L.");
  const family = new Node("p");
  global.window.DBGIScientificNames.append(family, "Poaceae", "family", "Barnhart");
  assert.equal(family.findAll("i").length, 0);
  const sample = new Node("section");
  inat.renderSample(sample, "dbgi_000037", data);
  assert.equal(sample.findAll("dd")[0].findAll("i")[0].textContent, "Echeveria elegans");
  assert.equal(sample.findAll("dd")[1].findAll("i")[0].textContent, "Echeveria elegans");
});
