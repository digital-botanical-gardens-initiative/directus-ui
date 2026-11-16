"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; }
  set textContent(value) { this.children = [String(value)]; }
  get textContent() { return this.children.map(child => child instanceof Node ? child.textContent : child).join(""); }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = [...items]; }
  setAttribute(name, value) { this.attributes[name] = value; }
  findAll(tag) {
    return [...(this.tag === tag ? [this] : []),
      ...this.children.flatMap(child => child instanceof Node ? child.findAll(tag) : [])];
  }
}

global.document = {createElement: tag => new Node(tag), createElementNS: (_ns, tag) => new Node(tag)};
global.window = {};
require("../assets/js/sample_subject.js");
const {show} = window.DBGIObservationSubject;

test("recorded leaf, flower, root and other plant parts retain distinct source values and icon paths", () => {
  const root = new Node("aside");
  const icons = new Set();
  for (const subject of ["Leaf", "Flower", "Root", "Stems", "Fruit", "Whole organism"]) {
    show(root, subject);
    assert.equal(root.hidden, false);
    assert.match(root.textContent, new RegExp(subject));
    assert.equal(root.findAll("svg").length, 1);
    assert.equal(root.findAll("svg")[0].attributes["aria-hidden"], "true");
    icons.add(root.findAll("path")[0].attributes.d);
  }
  assert.equal(icons.size, 6);
});

test("unrecognized Directus values remain verbatim without invented plant parts or HTML injection", () => {
  const root = new Node("aside");
  show(root, "chec_000107");
  const generic = root.findAll("path")[0].attributes.d;
  assert.match(root.textContent, /chec_000107/);
  show(root, " <img src=x onerror=alert(1)> ");
  assert.match(root.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(root.findAll("img").length, 0);
  assert.equal(root.findAll("path")[0].attributes.d, generic);
});

test("navigating to a sample without recorded subject removes the prior icon and label", () => {
  const root = new Node("aside");
  show(root, "Leaf");
  show(root, null);
  assert.equal(root.hidden, true);
  assert.equal(root.textContent, "");
  assert.equal(root.findAll("svg").length, 0);
  show(root, "   ");
  assert.equal(root.hidden, true);
});


test("compact card and map icons expose the recorded subject accessibly without altering sample IDs", () => {
  const cell = new Node("td");
  window.DBGIObservationSubject.inline(cell, "Flower");
  assert.equal(cell.findAll("svg").length, 1);
  assert.equal(cell.findAll("span")[0].attributes["aria-label"], "Observation subject: Flower");
  assert.equal(cell.findAll("span")[0].attributes.role, "img");
  window.DBGIObservationSubject.inline(cell, null);
  assert.equal(cell.findAll("svg").length, 1);
  window.DBGIObservationSubject.inline(cell, "chec_000107");
  assert.equal(cell.findAll("span")[1].attributes["aria-label"], "Observation subject: chec_000107");
});

test("list subject column retains recorded text and unknown values, but does not infer missing subjects", () => {
  const {cell} = window.DBGIObservationSubject;
  const flower = cell("Flower");
  assert.equal(flower.tag, "td");
  assert.match(flower.textContent, /Flower/);
  assert.equal(flower.findAll("svg").length, 1);
  assert.equal(flower.findAll("span")[0].attributes["aria-label"], "Observation subject: Flower");
  const missing = cell(null);
  assert.equal(missing.textContent, "—");
  assert.equal(missing.findAll("svg").length, 0);
  assert.match(cell("chec_000107").textContent, /chec_000107/);
});

test("subject options deduplicate case variants and filtering uses exact recorded value across full result sets", () => {
  const {populate, matches} = window.DBGIObservationSubject;
  const select = new Node("select");
  const row = (subject) => [...Array(9).fill(null), subject];
  populate(select, [row("Leaf"), row("leaf"), row("Flower"), row("chec_000107"), row(null)]);
  assert.deepEqual(select.findAll("option").map(option => [option.value, option.textContent]), [
    ["", "All subjects"], ["value:chec_000107", "chec_000107"],
    ["value:flower", "Flower"], ["value:leaf", "Leaf"], ["missing:", "Not recorded"],
  ]);
  assert.equal(matches("Leaf", "value:leaf"), true);
  assert.equal(matches("leaf", "value:leaf"), true);
  assert.equal(matches("Flower", "value:leaf"), false);
  assert.equal(matches(null, "missing:"), true);
  assert.equal(matches("Flower", "missing:"), false);
  assert.equal(matches(null, ""), true);
});