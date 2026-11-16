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
require("../assets/js/scientific_names.js");
require("../assets/js/inaturalist.js");
const inat = global.window.INaturalist;
const columns = ["sample_id", "field_id", "observation_id", "observer_taxon_id", "observer_name", "observer_rank",
  "community_taxon_id", "community_name", "community_rank", "col_id", "col_name", "col_rank", "status", "reason", "photos",
  "comments_count", "comments_source"];
const agreement = ["dbgi_000037", 91, 110560140, 9, "Other name", "species", 206749, "Echeveria elegans", "species",
  "COL-7", "Echeveria elegans", "species", "agreement", "Same scientific name at the same rank",
  [["https://inaturalist-open-data.s3.amazonaws.com/photos/186526029/square.jpeg", "no rights reserved", "cc0"],
   ["https://inaturalist-open-data.s3.amazonaws.com/photos/186526034/square.jpeg", "© Second creator", "cc-by"],
   ["https://inaturalist-open-data.s3.amazonaws.com/photos/186526039/square.jpeg", null, null]], 2, "iNaturalist API"];
const disagreement = ["dbgi_000037", 91, 110560141, 9, "Other name", "species", 6, "Echeveria agavoides", "species",
  "COL-7", "Echeveria elegans", "species", "potential disagreement", "Different scientific names at the same rank",
  [["https://static.inaturalist.org/photos/187000000/square.jpg", null, null]], 0, "Directus Curation_Data"];
const unassessable = ["dbgi_000038", 92, 110561024, 9, "Leonurus cardiaca", "species", null, null, null,
  null, null, null, "unassessable", "No iNaturalist community taxon ID", [], null, null];
// Directus Curation_Data observation on #sample/66367: an observer ID exists, but no community ID.
const prunusObserverOnly = ["dbgi_002453", 66367, 182149569, 55811, "Prunus spinosa", "species",
  null, null, null, "4N98J", "Prunus spinosa", "species", "unassessable",
  "No iNaturalist community taxon ID",
  [["https://inaturalist-open-data.s3.amazonaws.com/photos/317538459/square.jpg", "no rights reserved", "cc0"]], 1, "Directus Curation_Data"];
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

test("sample comment presence shows public source and links, without republishing comment text", () => {
  const root = new Node("section");
  inat.renderSample(root, "dbgi_000037", data);
  const [positive, zero] = root.findAll("article");
  assert.match(positive.textContent, /Comments: 2 \(iNaturalist API\)/);
  assert.match(positive.textContent, /read public comments \(if still available\) on the original observation/);
  assert.equal(positive.findAll("a").some((anchor) => anchor.href ===
    "https://www.inaturalist.org/observations/110560140"), true);
  assert.match(zero.textContent, /Comments: 0 \(Directus Curation_Data\)/);
  assert.doesNotMatch(zero.textContent, /read public comments/);
  inat.renderSample(root, "dbgi_000038", data);
  assert.match(root.textContent, /Comments: unknown \(no verified public count\)/);
});

test("observer-only Prunus identification is visible without claiming community agreement", () => {
  const root = new Node("section");
  const snapshot = {...data, rows: [...data.rows, prunusObserverOnly]};
  assert.equal(inat.renderSample(root, "dbgi_002453", snapshot), 1);
  const card = root.findAll("article")[0];
  assert.equal(card.findAll("details").length, 0);
  assert.equal(card.findAll("dt").map((term) => term.textContent).join(" · "),
    "Observer identification · iNaturalist community · Resolved CoL");
  const [observer, community, col] = card.findAll("dd");
  assert.equal(observer.textContent, "Prunus spinosa (species) · 55811");
  assert.match(community.textContent, /Not available.*no community taxon ID/);
  assert.equal(col.textContent, "Prunus spinosa (species) · 4N98J");
  assert.match(card.findAll("h4")[0].textContent, /unassessable/);
  assert.match(card.findAll("p").find((paragraph) => paragraph.className === "inat-reason").textContent,
    /Community comparison unassessable: no iNaturalist community taxon ID/);
  assert.match(card.findAll("p").find((paragraph) => paragraph.className === "inat-observer-note").textContent,
    /Observer-only observation:.*match at the same rank; this is not community agreement/);
  assert.equal(card.findAll("figure").length, 1);
  assert.equal(card.findAll("a").filter((anchor) => anchor.href ===
    "https://www.inaturalist.org/observations/182149569").length, 3);
  assert.equal(card.findAll("a").filter((anchor) => anchor.href ===
    "https://emi-collection.unifr.ch/directus/admin/content/Curation_Data/182149569").length, 1);
  assert.equal(card.findAll("a").some((anchor) => /Community taxon/.test(anchor.textContent)), false);
  inat.renderSample(root, "dbgi_000037", snapshot);
  const [agreed, disagreed] = root.findAll("article");
  assert.match(agreed.findAll("h4")[0].textContent, /agreement/);
  assert.match(disagreed.findAll("h4")[0].textContent, /potential disagreement/);
  assert.equal(agreed.findAll("p").some((paragraph) => paragraph.className === "inat-observer-note"), false);
  assert.equal(disagreed.findAll("p").some((paragraph) => paragraph.className === "inat-observer-note"), false);
  assert.match(disagreed.findAll("dd")[1].textContent, /Echeveria agavoides/);
  assert.match(disagreed.findAll("dd")[2].textContent, /Echeveria elegans/);
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

test("review orders the full matched set before its 200-row window and retains offscreen selections", () => {
  const root = new Node("section");
  const rows = Array.from({length: 201}, (_, index) =>
    [...disagreement.slice(0, 2), 1000 + index, ...disagreement.slice(3, 13),
      index === 200 ? "Distinct review reason" : disagreement[13], [], 1, "Directus Curation_Data"]);
  inat.renderReview(root, {...data, rows}, {rows: [[91]]});
  const body = root.findAll("tbody")[0];
  const count = root.findAll("p").find((item) => item.attrs["aria-live"] === "polite" &&
    item.textContent.includes("observations shown"));
  const checkbox = body.findAll("tr")[0].findAll("input")[0];
  checkbox.checked = true;
  checkbox.listeners.change();
  const order = root.findAll("select")[1];
  order.value = "2:desc";
  order.listeners.change();
  assert.equal(body.findAll("tr").length, 200);
  assert.match(count.textContent, /201 of 201/);
  assert.equal(body.findAll("tr")[0].findAll("a").find((a) => a.href.includes("/observations/")).href,
    "https://www.inaturalist.org/observations/1200");
  assert.equal(body.findAll("input").some((input) => input.checked), false);
  const search = root.findAll("input").find((item) => item.type === "search");
  search.value = "Distinct review reason";
  search.listeners.input();
  assert.equal(body.findAll("tr").length, 1);
  assert.match(count.textContent, /1 of 201/);
  search.value = "1000";
  search.listeners.input();
  assert.equal(body.findAll("tr")[0].findAll("input")[0].checked, true);
  assert.match(root.textContent, /1 selected for review/);
  assert.equal(body.findAll("tr")[0].findAll("a").find((a) => a.href.includes("/observations/")).href,
    "https://www.inaturalist.org/observations/1000");
});

test("comments filter spans every review status, excludes unknown and malformed counts, and pages all matches", () => {
  const root = new Node("section");
  const many = Array.from({length: 203}, (_, index) =>
    [...agreement.slice(0, 2), 300000 + index, ...agreement.slice(3, 15),
      1, "iNaturalist API"]);
  const malformed = [
    [...unassessable.slice(0, 15), "2", "iNaturalist API"],
    [...unassessable.slice(0, 15), 7, "unverified"],
    [...unassessable.slice(0, 15), -1, "Directus Curation_Data"],
  ];
  inat.renderReview(root, {...data, rows: [...many, disagreement, unassessable, ...malformed]},
    {rows: [[91], [92]]});
  const status = root.findAll("select")[0];
  const body = root.findAll("tbody")[0];
  const next = root.findAll("button").find((button) => button.textContent === "Next page");
  const previous = root.findAll("button").find((button) => button.textContent === "Previous page");
  assert.match(root.textContent, /203 with public comments · 4 comment counts unknown/);
  status.value = "comments";
  status.listeners.change();
  assert.equal(body.findAll("tr").length, 200);
  assert.match(root.textContent, /203 of 208 observations shown/);
  const selected = body.findAll("input")[0];
  selected.checked = true;
  selected.listeners.change();
  next.listeners.click();
  assert.equal(body.findAll("tr").length, 3);
  assert.match(root.textContent, /Page 2 of 2/);
  assert.equal(body.findAll("a").some((anchor) => anchor.href ===
    "https://www.inaturalist.org/observations/300202"), true);
  previous.listeners.click();
  assert.equal(body.findAll("tr")[0].findAll("input")[0].checked, true);
  assert.match(root.textContent, /1 selected for review/);
  const search = root.findAll("input").find((item) => item.type === "search");
  search.value = "300202";
  search.listeners.input();
  assert.equal(body.findAll("tr").length, 1);
  assert.match(root.textContent, /Page 1 of 1/);
  assert.equal(body.findAll("a").some((anchor) => anchor.href === "#sample/91"), true);
  assert.equal(body.findAll("a").some((anchor) => anchor.href ===
    "https://www.inaturalist.org/observations/300202"), true);
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
  assert.equal(sample.findAll("dd")[1].findAll("i")[0].textContent, "Echeveria elegans");
  assert.equal(sample.findAll("dd")[2].findAll("i")[0].textContent, "Echeveria elegans");
});
