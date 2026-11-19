"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

class Node {
  constructor(tag) { this.tag = tag; this.children = []; }
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
require("../assets/js/refresh_status.js");
const {render, load} = window.DBGIRefreshStatus;
const names = ["samples", "collectors", "garden_progress", "ms_profile", "processing", "inaturalist"];
const sample = {generated_at: "2026-11-14T07:28:00+00:00"};
const manifest = {sample_generated_at: sample.generated_at, completed_at: "2026-11-14T07:33:00+00:00",
  snapshots: Object.fromEntries(names.map((name) => [name, name === "samples" ? sample.generated_at : "2026-11-14T07:31:00+00:00"]))};

test("completed six-export refresh is shown in Swiss time with separately labeled sample fetch", () => {
  const root = new Node("aside");
  render(root, sample, manifest);
  assert.equal(root.hidden, false);
  assert.match(root.textContent, /Last successful Directus refresh: 14 Nov 2026, 08:33 \(Europe\/Zurich\)/);
  assert.match(root.textContent, /Field samples fetched 14 Nov 2026, 08:28/);
  assert.match(root.textContent, /Scheduled daily at 08:30/);
  assert.match(root.textContent, /GitHub may start later/);
  assert.equal(root.findAll("time")[0].dateTime, "2026-11-14T07:33:00.000Z");
  assert.equal(root.findAll("a")[0].href,
    "https://github.com/digital-botanical-gardens-initiative/directus-ui/actions/workflows/pages.yml");
  render(root, {generated_at: "2026-07-14T06:28:00+00:00"});
  assert.match(root.textContent, /14 Jul 2026, 08:28/);
});

test("Earth Metabolome site links refresh runs to its own deployment", () => {
  const root = new Node("aside");
  const previous = global.location;
  try {
    global.location = {hostname: "www.earthmetabolome.org"};
    render(root, sample, manifest);
    assert.equal(root.findAll("a")[0].href,
      "https://github.com/earth-metabolome-initiative/directus-ui/actions/workflows/pages.yml");
  } finally {
    global.location = previous;
  }
});

test("stale, partial, inconsistent and invalid completion metadata cannot claim a full refresh", () => {
  const root = new Node("aside");
  for (const untrusted of [null,
    {...manifest, sample_generated_at: "2026-11-13T07:28:00+00:00"},
    {...manifest, snapshots: {...manifest.snapshots, samples: "2026-11-14T07:29:00+00:00"}},
    {...manifest, snapshots: {samples: sample.generated_at}},
    {...manifest, completed_at: "2026-11-14T07:29:00+00:00"},
    {...manifest, snapshots: {...manifest.snapshots, processing: "2026-11-13T07:28:00+00:00"}},
    {...manifest, snapshots: {...manifest.snapshots, ms_profile: "bogus"}}]) {
    render(root, sample, untrusted);
    assert.match(root.textContent, /Field samples last fetched: 14 Nov 2026, 08:28/);
    assert.doesNotMatch(root.textContent, /Last successful Directus refresh/);
    assert.match(root.textContent, /No completed six-export refresh is recorded/);
  }
  render(root, {generated_at: "not-a-time"}, manifest);
  assert.equal(root.hidden, true);
});

test("unavailable optional marker leaves recorded sample time and schedule visible", async () => {
  const root = new Node("aside");
  global.fetch = async () => ({ok: false, status: 404});
  await load(root, sample);
  assert.match(root.textContent, /Field samples last fetched: 14 Nov 2026, 08:28/);
  global.fetch = async () => ({ok: true, json: async () => manifest});
  await load(root, sample);
  assert.match(root.textContent, /Last successful Directus refresh/);
});
