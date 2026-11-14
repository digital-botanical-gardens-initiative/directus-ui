"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

class Node {
  constructor(tag) { this.tag = tag; this.children = []; }
  set textContent(value) { this.replaceChildren(String(value)); }
  get textContent() { return this.children.map((child) => child instanceof Node ? child.textContent : child).join(""); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(key, value) { this[key] = value; }
  findAll(tag) {
    return [...(this.tag === tag ? [this] : []),
      ...this.children.flatMap((child) => child instanceof Node ? child.findAll(tag) : [])];
  }
}

global.document = {createElement: (tag) => new Node(tag)};
global.window = {};
require("../species_inat.js");
const {render} = window.SpeciesINat;
const species = [1077, "4TR9P", "Ruscus aculeatus", "L.", "species", null, "2026"];
const unmapped = [3153, "UNMAPPED", "Alchemilla fissa", null, "species", null, "2026"];
const mapping = {rows: [["4TR9P", "Q161425"]]};
const response = (data) => ({ok: true, json: async () => data});
const claim = (value) => ({mainsnak: {datavalue: {value}}});
const wiki = (claims) => ({entities: {Q161425: {claims: {P3151: claims}}}});
const photo = (id, license, attribution = "(c) photographer (CC BY)", host = "inaturalist-open-data.s3.amazonaws.com") => ({
  photo: {id, license_code: license, attribution, medium_url: `https://${host}/photos/${id}/medium.jpg`},
});

test("exact CoL→Wikidata→iNaturalist species link shows only credited CC photos, never sample observations", async () => {
  const urls = [];
  global.fetch = async (url, options) => {
    urls.push(url);
    assert.equal(options.referrerPolicy, "no-referrer");
    if (urls.length === 1) return response(wiki([claim("82904")]));
    return response({total_results: 1, results: [{id: 82904, rank: "species", is_active: true,
      name: "Ruscus aculeatus", taxon_photos: [photo(11, "cc-by"), photo(11, "cc-by"),
        photo(12, null), photo(13, "cc-by-nc", "(c) Nature fan (CC BY-NC)"),
        photo(14, "cc-by", "(c) odd host", "untrusted.example")]}]});
  };
  const root = new Node("section");
  await render(root, {taxon: species, mapping});
  assert.equal(root.hidden, false);
  assert.deepEqual(urls, [
    "https://www.wikidata.org/w/api.php?action=wbgetentities&ids=Q161425&props=claims&format=json&origin=*",
    "https://api.inaturalist.org/v1/taxa/82904",
  ]);
  assert.equal(root.findAll("img").length, 2);
  assert.deepEqual(root.findAll("img").map((img) => img.src), [
    "https://inaturalist-open-data.s3.amazonaws.com/photos/11/medium.jpg",
    "https://inaturalist-open-data.s3.amazonaws.com/photos/13/medium.jpg",
  ]);
  assert.match(root.textContent, /taxon reference photos, not photos of these Directus field samples/);
  assert.match(root.textContent, /Nature fan \(CC BY-NC\)/);
  assert.deepEqual(root.findAll("a").map((link) => link.href), [
    "https://www.inaturalist.org/taxa/82904", "https://www.inaturalist.org/photos/11",
    "https://www.inaturalist.org/photos/13",
  ]);
  assert.equal(root.findAll("img")[0].referrerPolicy, "no-referrer");

  render(root, {taxon: unmapped, mapping});
  assert.equal(root.hidden, true);
  assert.equal(root.findAll("img").length, 0);
  assert.equal(urls.length, 2);
});

test("ambiguous or inactive iNaturalist links cannot be assigned taxon photos", async () => {
  const root = new Node("section");
  const urls = [];
  global.fetch = async (url) => { urls.push(url); return response(wiki([claim("82904"), claim("765426")])); };
  await render(root, {taxon: species, mapping});
  assert.equal(urls.length, 1);
  assert.match(root.textContent, /No unique iNaturalist species taxon/);
  assert.equal(root.findAll("img").length, 0);

  urls.length = 0;
  global.fetch = async (url) => {
    urls.push(url);
    return response(urls.length === 1 ? wiki([claim("82904")]) :
      {total_results: 1, results: [{id: 82904, rank: "species", is_active: false,
        name: "Ruscus aculeatus", taxon_photos: [photo(11, "cc-by")]}]});
  };
  await render(root, {taxon: species, mapping});
  assert.match(root.textContent, /not an active species/);
  assert.equal(root.findAll("img").length, 0);
});

test("late response for an earlier species never replaces a newer species gallery", async () => {
  const root = new Node("section");
  let release;
  global.fetch = () => new Promise((resolve) => { release = resolve; });
  const pending = render(root, {taxon: species, mapping});
  render(root, {taxon: unmapped, mapping});
  release(response(wiki([claim("82904")])));
  await pending;
  assert.equal(root.hidden, true);
  assert.equal(root.textContent, "");
});
