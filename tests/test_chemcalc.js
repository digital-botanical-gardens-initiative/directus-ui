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
  dispatch(type) { this.events.get(type)?.({preventDefault() {}}); }
  findAll(tag) {
    return [...(this.tag === tag ? [this] : []),
      ...this.children.flatMap((child) => child instanceof Node ? child.findAll(tag) : [])];
  }
}

global.document = {createElement: (tag) => new Node(tag)};
global.window = {};
require("../assets/js/chemcalc.js");

const {render} = window.ChemCalc;

test("a LOTUS formula and ionization open a matching ChemCalc iframe and external result", () => {
  const root = new Node("section");
  render(root);
  assert.equal(root.findAll("iframe").length, 0, "no external request before user calculates");
  const [formula, ion] = root.findAll("input");
  formula.value = " C8H10N4O2 ";
  ion.value = "H+";
  root.findAll("form")[0].dispatch("submit");
  const frame = root.findAll("iframe")[0];
  const link = root.findAll("a")[0];
  const url = new URL(frame.src);
  assert.equal(url.hostname, "www.chemcalc.org");
  assert.equal(url.searchParams.get("mf"), "C8H10N4O2");
  assert.equal(url.searchParams.get("ionizations"), "H+");
  assert.equal(frame.referrerPolicy, "no-referrer");
  assert.equal(link.href, frame.src);
  assert.equal(link.target, "_blank");
  assert.equal(link.rel, "noopener noreferrer");

  formula.value = "C6H12O6";
  ion.value = "Na+";
  root.findAll("form")[0].dispatch("submit");
  assert.equal(root.findAll("iframe").length, 1, "replacing the formula unloads the prior result");
  assert.equal(new URL(root.findAll("iframe")[0].src).searchParams.get("ionizations"), "Na+");
  assert.equal(new URL(root.findAll("iframe")[0].src).searchParams.get("mf"), "C6H12O6");
  render(root);
  assert.equal(root.findAll("iframe").length, 0, "navigating away unloads ChemCalc");
});
