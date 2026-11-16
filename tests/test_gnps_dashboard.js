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
  setAttribute(name, value) { this[name] = value; }
  dispatch(type) { this.events.get(type)?.({preventDefault() {}}); }
  contains(node) { return this === node || this.children.some((child) => child instanceof Node && child.contains(node)); }
  findAll(tag) {
    return [...(this.tag === tag ? [this] : []),
      ...this.children.flatMap((child) => child instanceof Node ? child.findAll(tag) : [])];
  }
}

global.document = {createElement: (tag) => new Node(tag)};
global.window = {};
require("../assets/js/gnps_dashboard.js");
require("../assets/js/ms_profile.js");
const {render} = window.GNPSDashboard;
const profile = (id, filename, instrumentId = 7, methodId = null) =>
  [id, 1195, instrumentId, "OK", filename, methodId];
const first = "20240307_EB_dbgi_001195_01_01";
const usi = `mzspec:MSV000102993:${first}.mzML`;
const expected = `https://dashboard2.gnps2.org/?usi=${encodeURIComponent(usi)}&tic_option=BPI#${encodeURIComponent(JSON.stringify({usi, usi2: ""}))}`;
const view = (names, mz) => {
  const groupedUsi = names.map((name) => `mzspec:MSV000102993:${name}`).join("\n");
  const params = new URLSearchParams({usi: groupedUsi});
  if (names.length > 1) params.set("tic_overlay", "1");
  if (mz) params.set("xicmz", mz);
  params.set("tic_option", "BPI");
  return `https://dashboard2.gnps2.org/?${params}#${encodeURIComponent(JSON.stringify({usi: groupedUsi, usi2: ""}))}`;
};

test("one Directus file embeds the BPI GNPS view immediately and provides the same external link", () => {
  const root = new Node("section");
  render(root, {profiles: [profile(1, first)]});
  assert.equal(root.hidden, false);
  assert.equal(root.findAll("input").filter((node) => node.type === "checkbox").length, 0);
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

test("GNPS per-analysis chooser shows source method polarity independent of the filename", () => {
  const root = new Node("section");
  render(root, {profiles: [profile(1, "first_neg.mzML", 7, 10),
    profile(2, "second_pos.mzML", 7, 11), profile(3, "unknown.mzML", 7, 12)],
  injectionMethods: new Map([[10, "positive"], [11, "negative"], [12, null]])});
  assert.deepEqual(root.findAll("span").filter((span) => span.className?.startsWith("ms-polarity-badge"))
    .map((badge) => [badge.textContent, badge.title]),
    [["+", "Positive ionization · Directus Injection_Methods #10"],
      ["−", "Negative ionization · Directus Injection_Methods #11"]]);
});

test("selecting two files compares them in both URLs; errors, collapse and selection keep the view truthful", () => {
  const root = new Node("section");
  render(root, {profiles: [profile(1, first), profile(2, "second.mzML", 8), profile(3, first + ".mzML")]});
  const [firstBox, secondBox] = root.findAll("input").filter((node) => node.type === "checkbox");
  const preview = root.findAll("details")[0];
  const link = root.findAll("a")[0];
  const failure = root.findAll("p").find((node) => node.className === "gnps-failure");
  const status = root.findAll("p").find((node) => node.className === "gnps-selection-status");
  const provenance = root.findAll("p").find((node) => node.className === "gnps-provenance");
  assert.equal(root.findAll("fieldset")[0].findAll("legend")[0].textContent, "Select MS profile files to compare");
  assert.deepEqual(root.findAll("label").filter((node) => node.children.includes(firstBox) || node.children.includes(secondBox)).map((node) => node.textContent), [first + ".mzML", "second.mzML"]);
  assert.equal(firstBox.checked, true);
  assert.equal(secondBox.checked, false);
  assert.equal(status["aria-live"], "polite");
  const initialFrame = root.findAll("iframe")[0];
  assert.equal(initialFrame.src, expected);
  secondBox.checked = true;
  secondBox.dispatch("change");
  const combined = view([first + ".mzML", "second.mzML"]);
  assert.equal(link.href, combined);
  assert.equal(root.findAll("iframe")[0].src, combined);
  assert.match(root.findAll("iframe")[0].title, /comparing.*second.mzML/);
  assert.match(status.textContent, /Comparing 2 selected files.*Map and spectrum/);
  assert.match(provenance.textContent, /MS_Data #1.*MS_Data #2/);
  initialFrame.dispatch("error");
  assert.equal(failure.hidden, true);
  root.findAll("iframe")[0].dispatch("error");
  assert.equal(root.findAll("iframe").length, 0);
  assert.equal(failure.hidden, false);
  assert.equal(link.href, combined);
  preview.open = false;
  preview.dispatch("toggle");
  assert.equal(failure.hidden, true);
  secondBox.checked = false;
  secondBox.dispatch("change");
  assert.equal(link.href, expected);
  assert.doesNotMatch(provenance.textContent, /second.mzML/);
  assert.equal(root.findAll("iframe").length, 0);
  firstBox.checked = false;
  firstBox.dispatch("change");
  assert.equal(firstBox.checked, true, "at least one file remains selected");
  assert.equal(link.href, expected);
  preview.open = true;
  preview.dispatch("toggle");
  assert.equal(root.findAll("iframe")[0].src, expected);
  render(root, {profiles: [profile(4, null)]});
  assert.equal(root.findAll("iframe").length, 0);
  assert.equal(root.findAll("a").length, 0);
});

test("three selected files overlay together and changes preserve the actual selected list", () => {
  const root = new Node("section");
  render(root, {profiles: [profile(1, first), profile(2, "second.mzML"), profile(3, "third.mzML")]});
  const boxes = root.findAll("input").filter((node) => node.type === "checkbox");
  const link = root.findAll("a")[0];
  const status = root.findAll("p").find((node) => node.className === "gnps-selection-status");
  boxes[1].checked = true;
  boxes[1].dispatch("change");
  boxes[2].checked = true;
  boxes[2].dispatch("change");
  const all = [first + ".mzML", "second.mzML", "third.mzML"];
  assert.equal(link.href, view(all));
  assert.equal(root.findAll("iframe")[0].src, view(all));
  assert.deepEqual(new URL(link.href).searchParams.get("usi").split("\n"), all.map((name) => `mzspec:MSV000102993:${name}`));
  assert.equal(new URL(link.href).searchParams.get("tic_overlay"), "1");
  assert.equal(new URL(link.href).searchParams.get("tic_option"), "BPI");
  assert.match(status.textContent, /Comparing 3 selected files.*third.mzML.*Map and spectrum/);
  const massInput = root.findAll("input").find((node) => node.type === "text");
  massInput.value = "201.42";
  root.findAll("form")[0].dispatch("submit");
  assert.equal(link.href, view(all, "201.42"));
  assert.equal(root.findAll("iframe")[0].src, link.href);
  const preview = root.findAll("details")[0];
  preview.open = false;
  preview.dispatch("toggle");
  assert.equal(root.findAll("iframe").length, 0);
  assert.equal(link.href, view(all, "201.42"));
  preview.open = true;
  preview.dispatch("toggle");
  assert.equal(root.findAll("iframe")[0].src, link.href);
  boxes[1].checked = false;
  boxes[1].dispatch("change");
  assert.equal(link.href, view([first + ".mzML", "third.mzML"], "201.42"));
  assert.doesNotMatch(status.textContent, /second.mzML/);
  boxes[0].checked = false;
  boxes[0].dispatch("change");
  assert.equal(link.href, view(["third.mzML"], "201.42"));
  assert.equal(new URL(link.href).searchParams.has("tic_overlay"), false);
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

test("only valid current-sample records participate in comparison; unsafe names are never displayed or embedded", () => {
  const root = new Node("section");
  render(root, {profiles: [profile(1, "valid.MZML", null), profile(5, "safe-other"), [2, 1195, 7, "failed", "other"],
    [3, 1195, 7, "OK", "<img src=x onerror=alert(1)>"], [4, 1195, 7, "OK", null],
    [6, 1195, 7, "OK", "a?usi=inject"], profile(7, "valid.MZML")]});
  const boxes = root.findAll("input").filter((node) => node.type === "checkbox");
  assert.equal(boxes.length, 2);
  assert.equal(root.findAll("details")[0].open, true);
  boxes[1].checked = true;
  boxes[1].dispatch("change");
  assert.equal(root.findAll("iframe")[0].src, view(["valid.MZML", "safe-other.mzML"]));
  assert.equal(root.findAll("a")[0].href, view(["valid.MZML", "safe-other.mzML"]));
  assert.match(root.textContent, /MS_Data #1.*safe-other.mzML/);
  assert.doesNotMatch(root.textContent, /Instrument #null|<img|a\?usi=inject|MS_Data #7/);
  assert.equal(root.findAll("img").length, 0);
});

test("ChemCalc m/z plots the selected field sample's XIC and rejects unsafe masses", () => {
  const root = new Node("section");
  render(root, {profiles: [profile(1, first), profile(2, "second.mzML", 8)]});
  const input = root.findAll("input").find((node) => node.type === "text");
  const submit = root.findAll("form")[0];
  const boxes = root.findAll("input").filter((node) => node.type === "checkbox");
  const link = root.findAll("a")[0];
  const source = (url) => new URL(url).searchParams;

  input.value = "195.08765";
  submit.dispatch("submit");
  assert.equal(source(root.findAll("iframe")[0].src).get("xicmz"), "195.08765");
  assert.equal(source(link.href).get("tic_option"), "BPI");
  assert.equal(link.href, root.findAll("iframe")[0].src);

  boxes[1].checked = true;
  boxes[1].dispatch("change");
  assert.equal(root.findAll("iframe")[0].src, view([first + ".mzML", "second.mzML"], "195.08765"));
  assert.equal(link.href, view([first + ".mzML", "second.mzML"], "195.08765"));

  const selectedURL = root.findAll("iframe")[0].src;
  for (const invalid of ["0", "-1", "1e9", "NaN", "195&usi=other", "Infinity"]) {
    input.value = invalid;
    submit.dispatch("submit");
    assert.equal(root.findAll("iframe")[0].src, selectedURL);
    assert.equal(link.href, selectedURL);
  }

  boxes[0].checked = false;
  boxes[0].dispatch("change");
  assert.equal(source(root.findAll("iframe")[0].src).get("usi"), "mzspec:MSV000102993:second.mzML");
  assert.equal(source(root.findAll("iframe")[0].src).has("usi2"), false);
  assert.equal(source(root.findAll("iframe")[0].src).get("xicmz"), "195.08765");

  input.value = "";
  submit.dispatch("submit");
  assert.equal(source(root.findAll("iframe")[0].src).has("xicmz"), false);
  assert.equal(source(root.findAll("iframe")[0].src).get("tic_option"), "BPI");
  render(root, {profiles: [profile(3, first)]});
  assert.equal(source(root.findAll("iframe")[0].src).has("xicmz"), false);
});

test("shared selection places multiple files in two independent GNPS2 USI groups", () => {
  const root = new Node("section");
  const files = [profile(11, "first.mzML"), profile(12, "second.mzML"),
    profile(13, "third.mzML"), profile(14, "fourth.mzML")];
  const groups = new Map([[11, "A"], [12, "A"], [13, "B"], [14, "B"]]);
  render(root, {profiles: files, selectedIds: [11, 12, 13, 14], groupById: groups});
  const link = root.findAll("a")[0];
  const url = new URL(link.href);
  const firstGroup = ["first.mzML", "second.mzML"].map((name) => `mzspec:MSV000102993:${name}`).join("\n");
  const secondGroup = ["third.mzML", "fourth.mzML"].map((name) => `mzspec:MSV000102993:${name}`).join("\n");
  assert.equal(url.searchParams.get("usi"), firstGroup);
  assert.equal(url.searchParams.get("usi2"), secondGroup);
  assert.equal(url.searchParams.get("tic_overlay"), "1");
  assert.equal(url.searchParams.get("tic_option"), "BPI");
  assert.deepEqual(JSON.parse(decodeURIComponent(url.hash.slice(1))), {usi: firstGroup, usi2: secondGroup});
  assert.equal(root.findAll("iframe")[0].src, link.href);
  assert.match(root.findAll("iframe")[0].title, /group A.*group B/);
  groups.set(11, "B"); groups.set(12, "B");
  render(root, {profiles: files, selectedIds: [11, 12, 13, 14], groupById: groups});
  assert.equal(root.hidden, true, "a B-only selection cannot invent the required primary USI");
  assert.equal(root.findAll("iframe").length, 0);
});

test("explicit MS_Data IDs preselect all requested records across different fields without a chooser", () => {
  const root = new Node("section");
  const profiles = [[11, 401, 7, "OK", "oak.mzML", null],
    [12, 902, 7, "published", "spruce.mzML", null],
    [13, 1004, 8, "OK", "birch.mzML", null],
    [14, 1004, 8, "OK", "unsafe.raw", null]];
  render(root, {profiles, selectedIds: [11, 12, 13, 14, 999]});
  assert.equal(root.findAll("input").filter((node) => node.type === "checkbox").length, 0);
  assert.equal(root.findAll("a")[0].href, view(["oak.mzML", "spruce.mzML", "birch.mzML"]));
  assert.equal(root.findAll("iframe")[0].src, root.findAll("a")[0].href);
  assert.match(root.textContent, /MS_Data #11.*MS_Data #12.*MS_Data #13/);
  assert.doesNotMatch(root.textContent, /unsafe.raw/);
  assert.match(root.textContent, /assumed, not verified/);
  render(root, {profiles, selectedIds: [13]});
  assert.equal(root.findAll("a")[0].href, view(["birch.mzML"]));
  render(root, {profiles, selectedIds: []});
  assert.equal(root.hidden, true);
});
