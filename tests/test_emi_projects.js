"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const snapshot = require("../data/samples.json");
const catalog = require("../data/gardens.json");

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.listeners = {}; }
  set textContent(value) { this.children = [String(value)]; }
  get textContent() {
    return this.children.map((child) => child instanceof Node ? child.textContent : child).join("");
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  click() { this.listeners.click?.(); }
  findAll(tag) {
    return [...(this.tag === tag ? [this] : []),
      ...this.children.flatMap((child) => child instanceof Node ? child.findAll(tag) : [])];
  }
  byClass(name) {
    return [...(this.className?.split(" ").includes(name) ? [this] : []),
      ...this.children.flatMap((child) => child instanceof Node ? child.byClass(name) : [])];
  }
}

global.Element = Node;
global.document = {createElement: (tag) => new Node(tag)};
global.window = {};
require("../assets/js/garden_badges.js");
require("../assets/js/emi_projects.js");
const {partition, matches, render} = window.EMIProjects;
const aliases = new Map(catalog.gardens.flatMap((garden) => garden.aliases.map((alias) => [alias, garden])));
const gardenSummaries = catalog.gardens.map((garden) => ({
  id: garden.id,
  samples: snapshot.rows.filter((row) => aliases.get(row[2])?.id === garden.id).length,
}));

const scoped = (scope) => snapshot.rows.filter((row) => matches(row[2], scope, aliases, false));

test("real snapshot partitions every source row once between DBGI, five named projects and other Directus projects", () => {
  const result = partition(snapshot.rows, catalog);
  assert.equal(snapshot.rows.length, 10775);
  assert.equal(result.dbgi, 7349);
  assert.deepEqual(result.leading.map(({code, count}) => [code, count]), [
    ["fung", 722], ["champex_gradient", 405], ["bioblitz_vinesch", 257],
    ["macedonia", 188], ["manaslu", 84],
  ]);
  assert.equal(result.other.reduce((sum, project) => sum + project.count, 0), 1770);
  assert.equal(result.dbgi + result.leading.reduce((sum, project) => sum + project.count, 0) +
    result.other.reduce((sum, project) => sum + project.count, 0), snapshot.rows.length);
  assert.deepEqual(new Set(result.other.map(({code}) => code)), new Set([
    "artemisia_absinthium", "chemical_ecology", "droguier_jbn", "emi",
    "heloise_bachelor_FiBL", "medicin_alps", "sandbox", "sbl_20004",
  ]));
  assert.equal(result.other.some(({code}) => aliases.has(code)), false);
});

test("rendered EMI cards navigate to their precise sample scope, including accessible other projects", () => {
  const root = new Node("div"), selected = [];
  render(root, snapshot, catalog, gardenSummaries, (garden) => selected.push(`g:${garden}`),
    (scope) => selected.push(scope));
  assert.deepEqual(root.byClass("emi-projects__list")[0].findAll("h3").map((heading) => heading.textContent), [
    "DBGI", "Fung", "Champex gradient", "ViNEsh BioBlitz", "Macedonia mission", "Manaslu mission",
  ]);
  assert.deepEqual(root.findAll("details").map((details) => details.findAll("summary")[0].textContent), [
    "Explore five botanical gardens", "Other Directus projects (8)",
  ]);
  assert.equal(root.byClass("garden-badges__card").length, 5);
  assert.equal(root.byClass("emi-projects__card--dbgi")[0].textContent.includes("7,349 field samples"), true);
  const cards = root.byClass("emi-projects__card");
  assert.equal(cards.length, 14);
  for (const card of cards) {
    const link = card.byClass("emi-projects__link")[0];
    assert.equal(link.href, "#samples");
    link.click();
    assert.equal(scoped(selected.at(-1)).length,
      Number(card.byClass("emi-projects__count")[0].textContent.split(" ")[0].replaceAll(",", "")));
  }
  assert.deepEqual(selected.slice(0, 6), [
    "dbgi", "p:fung", "p:champex_gradient", "p:bioblitz_vinesch", "p:macedonia", "p:manaslu",
  ]);
  assert.equal(scoped("dbgi").some((row) => row[2] === "champex_gradient"), false);
  assert.equal(scoped("g:champex").length, 1621);
  assert.equal(scoped("p:champex_gradient").length, 405);
  root.byClass("garden-badges__select")[0].click();
  assert.equal(selected.at(-1), "g:fribourg");
  assert.equal(scoped(selected.at(-1)).length, 2559);
  assert.equal(matches("jbuf", "dbgi", aliases, true), false);
  assert.equal(matches("jbuf", "g:fribourg", aliases, true), true);
  assert.equal(matches("fung", "p:fung", aliases, true), false);
  assert.equal(matches("anything", "", aliases, true), true);
});

test("garden-only site renders its original five garden badges without EMI cards", () => {
  const dbgiCatalog = {gardens: catalog.gardens.map((garden) => ({...garden, aliases: [garden.id]}))};
  const gardenRows = snapshot.rows.filter((row) => aliases.has(row[2]))
    .map((row) => [...row.slice(0, 2), aliases.get(row[2]).id, ...row.slice(3)]);
  const root = new Node("div"), selected = [];
  render(root, {site: "dbgi", rows: gardenRows}, dbgiCatalog, gardenSummaries,
    (id) => selected.push(id), () => assert.fail("DBGI should not render EMI sample links"));
  assert.equal(root.byClass("garden-badges__card").length, 5);
  assert.equal(root.byClass("emi-projects__card").length, 0);
  assert.equal(root.findAll("details").length, 0);
  root.byClass("garden-badges__select")[2].click();
  assert.equal(selected[0], "neuchatel");
  assert.equal(gardenRows.length, 7349);
});
