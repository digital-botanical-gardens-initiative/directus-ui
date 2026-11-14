"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; }
  set textContent(value) { this.children = [String(value ?? "")]; }
  get textContent() { return this.children.map(child => child instanceof Element ? child.textContent : child).join(""); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(key, value) { this.attributes[key] = value; }
  findAll(tag) {
    return [...(this.tag === tag ? [this] : []),
      ...this.children.flatMap(child => child instanceof Element ? child.findAll(tag) : [])];
  }
}
global.document = {createElement: tag => new Element(tag), createElementNS: (_namespace, tag) => new Element(tag)};
global.window = {};
require("../sample_subject.js");
require("../collector_map.js");
const {mount} = window.DBGICollectorMap;
const taxon = [3, "COL-3", "Coffea arabica", "L.", "species", null];
function observation(id, longitude, latitude) {
  return {row: [id, `Sample ${id}`, "project", "recorded", longitude, latitude, null, taxon[0], null], taxon};
}
function fakeLeaflet() {
  const markers = [];
  const map = {
    zoom: 4, removed: false,
    getBounds() { return {contains: () => true}; },
    getZoom() { return this.zoom; },
    latLngToContainerPoint() { return {x: 100, y: 100}; },
    latLngToLayerPoint() { return {x: 100, y: 100}; },
    layerPointToLatLng({x, y}) { return [46.8 + (y - 100) / 100000, 7.1 + (x - 100) / 100000]; },
    setView(_latLng, zoom) { this.zoom = zoom; this.listeners.moveend(); },
    on(name, callback) { this.listeners ||= {}; this.listeners[name] = callback; },
    invalidateSize() {},
    fitBounds(bounds, options) { this.bounds = bounds; this.fitOptions = options; this.listeners.moveend(); },
    remove() { this.removed = true; },
  };
  const layer = {
    items: markers,
    addTo() { return this; },
    clearLayers() { markers.length = 0; },
  };
  const api = {
    map() { return map; },
    layerGroup() { return layer; },
    tileLayer() { return {addTo() { return this; }}; },
    latLngBounds: bounds => bounds,
    point: (x, y) => ({x, y}),
    divIcon: options => options,
    marker(location, options) {
      const item = {kind: "marker", location, options,
        addTo(target) { target.items.push(this); return this; },
        on(name, callback) { this.events ||= {}; this.events[name] = callback; },
        getLatLng() { return this.location; },
        click() { this.events.click(); }};
      return item;
    },
    polyline(location) {
      return {kind: "line", location, addTo(target) { target.items.push(this); return this; }};
    },
    popup() {
      return {setLatLng(value) { this.location = value; return this; },
        setContent(value) { this.content = value; return this; },
        openOn() { api.lastPopup = this; return this; }};
    },
  };
  return {api, map, markers};
}

 test("clusters valid Directus coordinates one zoom level at a time, then exposes every coincident species sample", async () => {
  const {api, map, markers} = fakeLeaflet();
  global.L = api;
  const root = new Element("div");
  let loads = 0;
  const controller = mount({root, observations: [observation(1, 7.1, 46.8),
    observation(2, 7.1, 46.8), observation(3, 200, 95)],
    loadLeaflet: () => { loads++; return Promise.resolve(); },
    renderScientificTaxon: (parent, entry) => parent.append(entry[2])});
  await controller.ready;
  assert.equal(loads, 1);
  assert.deepEqual(map.bounds, [[46.8, 7.1], [46.8, 7.1]]);
  assert.equal(map.fitOptions.maxZoom, 14);
  assert.equal(markers.length, 1);
  assert.equal(markers[0].options.icon.html, "<span>2</span>");
  markers[0].click();
  assert.equal(map.getZoom(), 5);
  assert.equal(markers[0].options.icon.html, "<span>2</span>");
  while (map.getZoom() < 19) markers[0].click();
  assert.equal(map.getZoom(), 19);
  assert.equal(markers.filter(item => item.kind === "marker").length, 2);
  assert.equal(markers.filter(item => item.kind === "line").length, 2);
  markers.find(item => item.kind === "marker").click();
  assert.deepEqual(api.lastPopup.content.findAll("a").map(link => link.href), ["#species/3", "#sample/1"]);
  assert.match(api.lastPopup.content.textContent, /46\.8, 7\.1 \(recorded latitude, longitude\)/);
  controller.destroy();
  assert.equal(map.removed, true);
  assert.equal(root.children.length, 0);
});

test("empty and unavailable maps retain species-list fallback without loading or fabricating points", async () => {
  const root = new Element("div");
  let loads = 0;
  const empty = mount({root, observations: [observation(4, null, null)],
    loadLeaflet: () => { loads++; return Promise.resolve(); }, renderScientificTaxon() {}});
  await empty.ready;
  assert.equal(loads, 0);
  assert.match(root.textContent, /No .* samples have valid coordinates/);
  empty.destroy();
  const failed = mount({root, observations: [observation(1, 7.1, 46.8)],
    loadLeaflet: () => Promise.reject(new Error("Map stylesheet could not load")),
    renderScientificTaxon() {}});
  await failed.ready;
  assert.match(root.textContent, /Map stylesheet could not load/);
  failed.destroy();
});

test("a genus map retains every descendant sample and links genus-resolved and species-resolved points correctly", async () => {
  const {api, map, markers} = fakeLeaflet();
  global.L = api;
  const root = new Element("div");
  const genus = [2984, "8W2YL", "Quercus", "L.", "genus", null];
  const species = [2990, "COL-Q", "Quercus robur", "L.", "species", 2984];
  const observations = [
    {...observation(11, 7.1, 46.8), taxon: genus},
    {...observation(12, 7.1, 46.8), taxon: species},
  ];
  const controller = mount({root, observations, loadLeaflet: () => Promise.resolve(),
    renderScientificTaxon: (parent, entry) => parent.append(entry[2]),
    scopeLabel: "Quercus", taxonHref: (entry) => `#${entry[4] === "species" ? "species" : "taxon"}/${entry[0]}`});
  await controller.ready;
  while (map.getZoom() < 19) markers[0].click();
  const points = markers.filter((item) => item.kind === "marker");
  assert.equal(points.length, 2);
  points[0].click();
  assert.deepEqual(api.lastPopup.content.findAll("a").map((link) => link.href), ["#taxon/2984", "#sample/11"]);
  points[1].click();
  assert.deepEqual(api.lastPopup.content.findAll("a").map((link) => link.href), ["#species/2990", "#sample/12"]);
  controller.destroy();
});

test("collector maps include geolocated field records without a resolved species and never fabricate species links", async () => {
  const {api, markers} = fakeLeaflet();
  global.L = api;
  const root = new Element("div");
  const unresolved = {...observation(44, 7.1, 46.8), taxon: null};
  unresolved.row[3] = "Recorded name only";
  unresolved.row[9] = "Root";
  const controller = mount({root, observations: [unresolved],
    loadLeaflet: () => Promise.resolve(),
    renderScientificTaxon: () => { throw new Error("Cannot render a missing taxon"); },
    scopeLabel: "field"});
  await controller.ready;
  const marker = markers.find(item => item.kind === "marker");
  assert.match(marker.options.title, /Recorded name only/);
  marker.click();
  assert.deepEqual(api.lastPopup.content.findAll("a").map(link => link.href), ["#sample/44"]);
  assert.match(api.lastPopup.content.textContent, /Recorded field name \(no resolved species\): Recorded name only/);
  assert.equal(api.lastPopup.content.findAll("span")[0].attributes["aria-label"], "Observation subject: Root");
  controller.destroy();
});
