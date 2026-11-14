"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.style = {}; }
  set textContent(value) { this.replaceChildren(String(value)); }
  get textContent() {
    return this.children.map((child) => child instanceof Node ? child.textContent : child).join("");
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attributes[name] = value; }
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
global.document = {createElement: (tag) => new Node(tag), createTextNode: String};
global.window = {};
require("../garden_progress.js");
const {render} = window.GardenProgress;

const sample = {
  generated_at: "2026-11-14T10:00:00Z", method: "Only Directus linked records",
  source: "https://example.test/directus/items/", total_samples: 7,
  ms_without_extraction_samples: 1,
  gardens: [
    {garden: "One", samples: 5, collected_only: 2, extraction_record_present: 1, ms_record_present: 2},
    {garden: "Two", samples: 2, collected_only: 1, extraction_record_present: 1, ms_record_present: 0},
  ],
};

test("profile-first stacked bars accompany cumulative collected, extracted and profiled totals", () => {
  const root = new Node("section");
  render(root, sample);
  const rows = root.findAll("tbody")[0].findAll("tr");
  assert.deepEqual(rows.map((row) => row.findAll("td").slice(1).map((cell) => cell.textContent)), [
    ["5 (100.0%)", "3 (60.0%)", "2 (40.0%)"],
    ["2 (100.0%)", "1 (50.0%)", "0 (0.0%)"],
  ]);
  const bar = rows[0].byClass("garden-progress__bar")[0];
  assert.deepEqual(bar.children.map((segment) => segment.className.split(" ").at(-1)), [
    "garden-progress__ms_record_present", "garden-progress__extraction_record_present", "garden-progress__collected_only",
  ]);
  assert.deepEqual(bar.children.map((segment) => segment.style.width), ["40%", "20%", "40%"]);
  assert.match(bar.attributes["aria-label"], /Collected 5 \(100\.0%\).*Extracted 3 \(60\.0%\).*Profiled 2 \(40\.0%\)/);
  assert.match(root.textContent, /1 profiled samples lack a linked extraction record/);
});

test("missing lineage accounting and inconsistent stage totals fail closed", () => {
  const root = new Node("section");
  assert.throws(() => render(root, {...sample, ms_without_extraction_samples: undefined}), /Invalid garden progress snapshot/);
  assert.throws(() => render(root, {...sample, ms_without_extraction_samples: 3}), /Incomplete garden progress snapshot/);
  assert.throws(() => render(root, {...sample, gardens: [
    {...sample.gardens[0], ms_record_present: 3}, sample.gardens[1],
  ]}), /Inconsistent garden progress snapshot/);
});
