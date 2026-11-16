"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

class Node {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
  }
  set textContent(value) { this.replaceChildren(String(value)); }
  get textContent() { return this.children.map((child) => child instanceof Node ? child.textContent : child).join(""); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  findAll(tag) {
    return [...(this.tag === tag ? [this] : []),
      ...this.children.flatMap((child) => child instanceof Node ? child.findAll(tag) : [])];
  }
}

global.document = {createElement: (tag) => new Node(tag)};
global.window = {};
require("../assets/js/scientific_names.js");
require("../assets/js/metabolome.js");
const {render} = window.Metabolome;
const mapping = {source: "https://www.wikidata.org", property: "P10585", generated_at: "2026-11-14T00:00:00Z",
  rows: [["COL-A", "Q15385247"], ["COL-B", "Q42"]]};
const genus = [1, "GENUS", "Echeveria", null, "genus", null, "2026"];
const species = [2, "COL-A", "Echeveria elegans", "Rose", "species", 1, "2026"];
const subspecies = [3, "SUB-A", "Echeveria elegans subsp. elegans", null, "subspecies", 2, "2026"];
const otherSpecies = [4, "COL-UNMAPPED", "Echeveria agavoides", null, "species", 1, "2026"];
const brugmansiaGenus = [8, "GENUS-B", "Brugmansia", null, "genus", null, "2026"];
const brugmansiaSpecies = [9, "COL-BRUG", "Brugmansia insignis", null, "species", 8, "2026"];
const taxaById = new Map([genus, species, subspecies, otherSpecies, brugmansiaGenus, brugmansiaSpecies]
  .map((taxon) => [taxon[0], taxon]));
const show = (root, taxon, taxonMap = taxaById, qids = mapping) => render(root, {taxon, taxaById: taxonMap, mapping: qids});

test("mapped species and descendant searches execute for their Directus species CoL ID", () => {
  const root = new Node("section");
  show(root, species);
  const frame = root.findAll("iframe")[0];
  const url = "https://lotus-initiative.github.io/lotus-explore-rs/search/?taxon=Q15385247&execute=true";
  assert.equal(root.hidden, false);
  assert.equal(root.findAll("i")[0].textContent, "Echeveria elegans");
  assert.equal(frame.src, url);
  assert.equal(frame.referrerPolicy, "no-referrer");
  const link = root.findAll("a")[0];
  assert.equal(link.href, url);
  assert.equal(link.target, "_blank");
  assert.equal(link.rel, "noopener noreferrer");
  show(root, subspecies);
  assert.equal(root.findAll("iframe")[0].src, url);
  assert.equal(root.findAll("iframe").length, 1);
  assert.equal(root.findAll("i")[0].textContent, "Echeveria elegans");
});

test("unresolved species ancestry hides and unloads the previous external search", () => {
  const root = new Node("section");
  const hidden = (taxon, taxonMap = taxaById, qids = mapping) => {
    show(root, taxon, taxonMap, qids);
    assert.equal(root.hidden, true);
    assert.equal(root.findAll("iframe").length, 0);
    assert.equal(root.findAll("a").length, 0);
    assert.equal(root.textContent, "");
  };
  show(root, species);
  hidden(genus);
  show(root, brugmansiaSpecies);
  hidden(null);
  hidden([5, "COL-A", "Looks like species", null, "subspecies", 999, "2026"]);
  hidden([6, "COL-A", "Cycle", null, "variety", 6, "2026"], new Map([[6, [6, "COL-A", "Cycle", null, "variety", 6, "2026"]]]));
  hidden([5, "COL-A", "Wrong key", null, "subspecies", 999, "2026"],
    new Map([[999, [2, "COL-A", "Unrelated", null, "species", null, "2026"]]]));
  hidden(species, null);
});

test("unmapped species searches its Directus genus rather than inventing an exact species match", () => {
  const root = new Node("section");
  show(root, brugmansiaSpecies);
  const url = "https://lotus-initiative.github.io/lotus-explore-rs/search/?taxon=Brugmansia&execute=true";
  assert.equal(root.hidden, false);
  assert.equal(root.findAll("iframe")[0].src, url);
  assert.equal(root.findAll("a")[0].href, url);
  assert.match(root.findAll("a")[0].textContent, /genus search/);
  const guidance = root.findAll("p")[0].textContent;
  assert.match(guidance, /Directus genus Brugmansia/);
  assert.match(guidance, /can include other species/);
  assert.doesNotMatch(guidance, /Brugmansia insignis/);
  show(root, otherSpecies, taxaById, {rows: []});
  assert.equal(root.findAll("iframe")[0].src,
    "https://lotus-initiative.github.io/lotus-explore-rs/search/?taxon=Echeveria&execute=true");
  assert.equal(root.findAll("iframe").length, 1);
});

test("genus fallback uses only a real Directus ancestor and encodes its name", () => {
  const root = new Node("section");
  const oddGenus = [11, "GENUS-ODD", "A&B genus", null, "genus", null, "2026"];
  const oddSpecies = [12, "COL-ODD", "Different species name", null, "species", 11, "2026"];
  show(root, oddSpecies, new Map([[11, oddGenus]]));
  assert.equal(root.findAll("iframe")[0].src,
    "https://lotus-initiative.github.io/lotus-explore-rs/search/?taxon=A%26B%20genus&execute=true");
  assert.match(root.findAll("p")[0].textContent, /A&B genus/);
  show(root, oddSpecies, new Map([[11, [99, "GENUS-ODD", "Wrong key", null, "genus", null, "2026"]]]));
  assert.equal(root.findAll("iframe")[0].src, "https://lotus-initiative.github.io/lotus-explore-rs/search/");
});

test("missing or malformed species mapping remains a genus search; missing genus leaves a manual form", () => {
  const root = new Node("section");
  const genusUrl = "https://lotus-initiative.github.io/lotus-explore-rs/search/?taxon=Echeveria&execute=true";
  for (const qids of [null, {}, {rows: "invalid"}, {rows: [["COL-A", "Q0"]]}]) {
    show(root, species, taxaById, qids);
    assert.equal(root.findAll("iframe")[0].src, genusUrl);
    assert.equal(root.findAll("a")[0].href, genusUrl);
  }
  show(root, [10, "COL-ORPHAN", "Orphan species", null, "species", 999, "2026"]);
  assert.equal(root.findAll("iframe")[0].src, "https://lotus-initiative.github.io/lotus-explore-rs/search/");
  assert.equal(root.findAll("a")[0].href, "https://lotus-initiative.github.io/lotus-explore-rs/search/");
  assert.match(root.findAll("p")[0].textContent, /Enter a genus name/);
  assert.equal(root.findAll("iframe").length, 1);
});

test("only exact CoL IDs with safe QIDs build species URLs, and names are inserted as text", () => {
  const root = new Node("section");
  const taxon = [7, "COL-B ", "<img src=x onerror=alert(1)>", null, "species", 1, "2026"];
  show(root, taxon);
  assert.equal(root.findAll("iframe")[0].src,
    "https://lotus-initiative.github.io/lotus-explore-rs/search/?taxon=Echeveria&execute=true");
  show(root, [7, "COL-B", taxon[2], null, "species", 1, "2026"]);
  assert.equal(root.findAll("iframe")[0].src, "https://lotus-initiative.github.io/lotus-explore-rs/search/?taxon=Q42&execute=true");
  assert.match(root.findAll("h3")[0].textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(root.findAll("img").length, 0);
  for (const qid of ["Q0", "Q12/evil", "Q12#evil", "Q12?evil", "q12", "Q12<script>", "Q12 ", 12]) {
    show(root, species, taxaById, {rows: [["COL-A", qid]]});
    assert.equal(root.hidden, false);
    assert.equal(root.findAll("iframe")[0].src,
      "https://lotus-initiative.github.io/lotus-explore-rs/search/?taxon=Echeveria&execute=true");
    assert.doesNotMatch(root.findAll("iframe")[0].src, /Q12/);
  }
});

test("explicit unscoped search loads only the public LOTUS form without a fabricated taxon", () => {
  const root = new Node("section");
  render(root, {taxaById, mapping, manual: true});
  assert.equal(root.hidden, false);
  assert.equal(root.findAll("iframe")[0].src, "https://lotus-initiative.github.io/lotus-explore-rs/search/");
  assert.match(root.textContent, /unscoped literature search/);
  assert.equal(window.Metabolome.speciesAncestor(subspecies, taxaById), species);
  render(root, {taxon: genus, taxaById, mapping, manual: true});
  assert.equal(root.findAll("iframe")[0].src, "https://lotus-initiative.github.io/lotus-explore-rs/search/");
  assert.equal(root.findAll("iframe").length, 1);
});
