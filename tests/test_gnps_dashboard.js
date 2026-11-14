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
  contains(node) { return this === node || this.children.some((child) => child instanceof Node && child.contains(node)); }
  findAll(tag) {
    return [...(this.tag === tag ? [this] : []),
      ...this.children.flatMap((child) => child instanceof Node ? child.findAll(tag) : [])];
  }
}

global.document = {createElement: (tag) => new Node(tag)};
global.window = {};
require("../gnps_dashboard.js");
const {render} = window.GNPSDashboard;
const profile = (id, filename, instrumentId = 7) => [id, 1195, instrumentId, "OK", filename];
const first = "20240307_EB_dbgi_001195_01_01";
const usi = `mzspec:MSV000102993:${first}.mzML`;
const expected = `https://dashboard2.gnps2.org/?usi=${encodeURIComponent(usi)}&tic_option=BPI#${encodeURIComponent(JSON.stringify({usi, usi2: ""}))}`;

test("one Directus file embeds the BPI GNPS view immediately and provides the same external link", () => {
  const root = new Node("section");
  render(root, {profiles: [profile(1, first)]});
  assert.equal(root.hidden, false);
  assert.equal(root.findAll("select").length, 0);
  const link = root.findAll("a")[0];
  assert.equal(link.href, expected);
  assert.equal(new URL(link.href).searchParams.get("tic_option"), "BPI");
  assert.equal(new URL(link.href).searchParams.has("ms2_identifier"), false);
  assert.equal(link.target, "_blank");
  assert.equal(link.rel, "noopener noreferrer");
  assert.equal(link.referrerPolicy, "no-referrer");
  const preview = root.findAll("details")[0];
  assert.equal(preview.open, true);
  const frame = root.findAll("iframe")[0];
  assert.equal(frame.src, expected);
  assert.equal(frame.loading, "lazy");
  assert.equal(frame.referrerPolicy, "no-referrer");
  assert.match(frame.title, new RegExp(first));
  preview.dispatch("toggle");
  assert.equal(root.findAll("iframe")[0], frame, "initial toggle must not reload the iframe");
});

test("multiple files switch embedded BPI views; collapse unloads and reopening restores the selected file", () => {
  const root = new Node("section");
  render(root, {profiles: [profile(1, first), profile(2, "second.mzML", 8), profile(3, first + ".mzML")]});
  const select = root.findAll("select")[0];
  const label = root.findAll("label")[0];
  const preview = root.findAll("details")[0];
  const link = root.findAll("a")[0];
  const failure = root.findAll("p").find((node) => node.className === "gnps-failure");
  assert.ok(label.children.includes(select));
  assert.deepEqual(root.findAll("option").map((node) => node.value), [first + ".mzML", "second.mzML"]);
  const initialFrame = root.findAll("iframe")[0];
  assert.equal(initialFrame.src, expected);
  select.value = "second.mzML";
  select.dispatch("change");
  const secondURL = "https://dashboard2.gnps2.org/?usi=mzspec%3AMSV000102993%3Asecond.mzML&tic_option=BPI#%7B%22usi%22%3A%22mzspec%3AMSV000102993%3Asecond.mzML%22%2C%22usi2%22%3A%22%22%7D";
  assert.equal(link.href, secondURL);
  const secondFrame = root.findAll("iframe")[0];
  assert.notEqual(secondFrame, initialFrame);
  assert.equal(secondFrame.src, secondURL);
  initialFrame.dispatch("error");
  assert.equal(failure.hidden, true);
  secondFrame.dispatch("error");
  assert.equal(root.findAll("iframe").length, 0);
  assert.equal(failure.hidden, false);
  assert.equal(link.href, secondURL);
  preview.open = false;
  preview.dispatch("toggle");
  assert.equal(failure.hidden, true);
  select.value = first + ".mzML";
  select.dispatch("change");
  assert.equal(link.href, expected);
  assert.equal(root.findAll("iframe").length, 0);
  preview.open = true;
  preview.dispatch("toggle");
  assert.equal(root.findAll("iframe")[0].src, expected);
  render(root, {profiles: [profile(4, null)]});
  assert.equal(root.findAll("iframe").length, 0);
  assert.equal(root.findAll("a").length, 0);
});

test("missing, unsafe and unsupported filenames never embed or generate a GNPS URL", () => {
  const root = new Node("section");
  for (const invalid of [null, "", "../escape", "nested/file", "a\\b", "other.raw", "other.mzXML", ".mzML", "a..mzML", "has space", "a?usi=x", "a#fragment", "a%2FmzML", "<script>", 42]) {
    render(root, {profiles: [profile(3, invalid)]});
    assert.equal(root.hidden, true, `Unsafe filename ${String(invalid)} must not embed`);
    assert.equal(root.findAll("iframe").length, 0);
    assert.equal(root.findAll("a").length, 0);
  }
  render(root, {profiles: [profile(3, first, 5)]});
  assert.equal(root.hidden, false);
  render(root, {profiles: [profile(4, "other.raw"), profile(5, null)]});
  assert.equal(root.hidden, true);
  assert.equal(root.findAll("iframe").length, 0);
  assert.equal(root.findAll("a").length, 0);
  render(root, {profiles: []});
  assert.equal(root.hidden, true);
  render(root, {profiles: null});
  assert.equal(root.hidden, true);
  render(root);
  assert.equal(root.hidden, true);
});

test("only valid current-sample records are embedded; input text is never interpreted as HTML", () => {
  const root = new Node("section");
  render(root, {profiles: [profile(1, "valid.MZML", null), [2, 1195, 7, "failed", "other"],
    [3, 1195, 7, "OK", "<img src=x onerror=alert(1)>"], [4, 1195, 7, "OK", null]]});
  assert.equal(root.findAll("details")[0].open, true);
  assert.equal(root.findAll("iframe")[0].src.includes("valid.MZML"), true);
  assert.equal(root.findAll("select").length, 0);
  assert.match(root.textContent, /MS_Data #1.*valid.MZML/);
  assert.doesNotMatch(root.textContent, /Instrument #null|other|<img/);
  assert.equal(root.findAll("img").length, 0);
});

test("ChemCalc m/z plots the selected field sample's XIC and rejects unsafe masses", () => {
  const root = new Node("section");
  render(root, {profiles: [profile(1, first), profile(2, "second.mzML", 8)]});
  const input = root.findAll("input")[0];
  const submit = root.findAll("form")[0];
  const select = root.findAll("select")[0];
  select.value = first + ".mzML"; // The DOM selects its first option automatically; this test double does not.
  const link = root.findAll("a")[0];
  const source = (url) => new URL(url).searchParams;

  input.value = "195.08765";
  submit.dispatch("submit");
  assert.equal(source(root.findAll("iframe")[0].src).get("xicmz"), "195.08765");
  assert.equal(source(link.href).get("tic_option"), "BPI");
  assert.equal(link.href, root.findAll("iframe")[0].src);

  select.value = "second.mzML";
  select.dispatch("change");
  assert.equal(source(root.findAll("iframe")[0].src).get("usi"), "mzspec:MSV000102993:second.mzML");
  assert.equal(source(root.findAll("iframe")[0].src).get("xicmz"), "195.08765");

  const selectedURL = root.findAll("iframe")[0].src;
  for (const invalid of ["0", "-1", "1e9", "NaN", "195&usi=other", "Infinity"]) {
    input.value = invalid;
    submit.dispatch("submit");
    assert.equal(root.findAll("iframe")[0].src, selectedURL);
    assert.equal(link.href, selectedURL);
  }

  input.value = "";
  submit.dispatch("submit");
  assert.equal(source(root.findAll("iframe")[0].src).has("xicmz"), false);
  assert.equal(source(root.findAll("iframe")[0].src).get("tic_option"), "BPI");
  render(root, {profiles: [profile(3, first)]});
  assert.equal(source(root.findAll("iframe")[0].src).has("xicmz"), false);
});
