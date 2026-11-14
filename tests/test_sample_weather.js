"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

class Node {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.parent = null;
    this.value = "";
    this.attrs = {};
    this.listeners = {};
    this.classList = {add: (...names) => { this.className = [this.className, ...names].join(" "); }};
  }
  set textContent(text) { this.value = String(text); this.replaceChildren(); }
  get textContent() { return this.value + this.children.map((child) =>
    typeof child === "string" ? child : child.textContent).join(""); }
  append(...children) {
    for (const child of children) {
      if (typeof child !== "string") child.parent = this;
      this.children.push(child);
    }
  }
  replaceChildren(...children) {
    for (const child of this.children) if (typeof child !== "string") child.parent = null;
    this.children = [];
    this.append(...children);
  }
  remove() {
    if (this.parent) {
      this.parent.children.splice(this.parent.children.indexOf(this), 1);
      this.parent = null;
    }
  }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener(event, handler) { this.listeners[event] = handler; }
  click() { return this.listeners.click(); }
  find(tag) {
    if (this.tag === tag) return this;
    for (const child of this.children) {
      if (typeof child === "string") continue;
      const result = child.find(tag);
      if (result) return result;
    }
    return null;
  }
}

global.document = {
  createElement: (tag) => new Node(tag),
  createElementNS: (namespace, tag) => new Node(tag),
};
global.window = {};
require("../sample_weather.js");
const weather = global.window.SampleWeather;
const sample = {sampleId: "sample-should-not-leak", date: "20240625134458", latitude: 47, longitude: 7};

function response(times, {timezone = "Europe/Zurich", temperatures = [12, 22, 32],
  humidities = [50, 65, 70], codes = [0, 2, 3]} = {}) {
  return {ok: true, json: async () => ({timezone, hourly_units: {
    time: "unixtime", temperature_2m: "°C", relative_humidity_2m: "%",
  }, hourly: {time: times, temperature_2m: temperatures,
    relative_humidity_2m: humidities, weather_code: codes}})};
}

function hours(...utcHours) {
  return utcHours.map((hour) => Date.UTC(2024, 5, 25, hour) / 1000);
}

function settled() { return new Promise((resolve) => setImmediate(resolve)); }

test("automatically loads the recorded hour in the inferred historic time zone without disclosing the sample ID", async () => {
  const root = new Node("section");
  let calls = 0;
  global.fetch = async (url, options) => {
    calls++;
    const params = new URL(url).searchParams;
    assert.equal(params.get("start_date"), "2024-06-24");
    assert.equal(params.get("end_date"), "2024-06-26");
    assert.equal(params.get("timezone"), "auto");
    assert.equal(params.get("timeformat"), "unixtime");
    assert.equal(params.get("latitude"), "47");
    assert.equal(params.get("longitude"), "7");
    assert.equal(params.has("sampleId"), false);
    assert.equal(url.toString().includes(sample.sampleId), false);
    assert.equal(options.credentials, "omit");
    assert.equal(options.referrerPolicy, "no-referrer");
    return response(hours(10, 11, 12));
  };
  weather.render(root, sample);
  assert.equal(calls, 1);
  await settled();
  assert.match(root.textContent, /Partly cloudy/);
  assert.match(root.textContent, /22\.0 °C/);
  assert.match(root.textContent, /65 %/);
  assert.match(root.textContent, /13:00–13:59 \(Europe\/Zurich\)/);
  assert.equal(root.find("svg").attrs["aria-hidden"], "true");
  assert.equal(root.find("button"), null);
  assert.match(root.textContent, /Weather: Open-Meteo.com/);
  assert.match(root.textContent, /automatically sends its coordinates/);
  assert.equal(root.find("details").find("summary").textContent, "Source, privacy & limitations");
});

test("missing or invalid source fields never make a request", () => {
  const root = new Node("section");
  global.fetch = () => { throw new Error("must not request"); };
  for (const fields of [
    {...sample, date: null}, {...sample, latitude: null},
    {...sample, date: "20240230092333"}, {...sample, date: "20240625134460"},
    {...sample, date: "20240625"}, {...sample, date: "19391231235959"},
    {...sample, date: "20991231235959"}, {...sample, longitude: 181},
  ]) {
    weather.render(root, fields);
    assert.match(root.textContent, /Weather unavailable/);
    assert.equal(root.find("button"), null);
  }
  weather.clear(root);
  weather.clear(root);
  assert.equal(root.textContent, "");
});

test("DST repeated and skipped local hours never choose an arbitrary instant", async () => {
  const root = new Node("section");
  global.fetch = async () => response([
    Date.UTC(2024, 10, 3, 5) / 1000, Date.UTC(2024, 10, 3, 6) / 1000,
    Date.UTC(2024, 10, 3, 7) / 1000,
  ], {timezone: "America/New_York"});
  weather.render(root, {...sample, date: "20241103014500"});
  await settled();
  assert.match(root.textContent, /hour occurs twice/);
  assert.doesNotMatch(root.textContent, /12\.0 °C/);

  global.fetch = async () => response([
    Date.UTC(2024, 2, 10, 6) / 1000, Date.UTC(2024, 2, 10, 7) / 1000,
    Date.UTC(2024, 2, 10, 8) / 1000,
  ], {timezone: "America/New_York"});
  weather.render(root, {...sample, date: "20240310023000"});
  await settled();
  assert.match(root.textContent, /no complete historical estimate/);
  assert.equal(root.find("svg"), null);
});

test("absent values and failed API calls show unavailability without invented numbers", async () => {
  const root = new Node("section");
  global.fetch = async () => response(hours(10, 11, 12), {temperatures: [12, null, 32]});
  weather.render(root, sample);
  await settled();
  assert.match(root.textContent, /no complete historical estimate/);
  assert.doesNotMatch(root.textContent, /0\.0 °C/);
  global.fetch = async () => ({ok: false});
  weather.render(root, sample);
  await settled();
  assert.match(root.textContent, /archive could not be reached/);
  await root.find("button").click();
  assert.match(root.textContent, /archive could not be reached/);
});

test("navigation invalidates an in-flight reply even if fetch ignores abort", async () => {
  const root = new Node("section");
  const responses = [];
  global.fetch = () => new Promise((done) => { responses.push(done); });
  weather.render(root, sample);
  weather.render(root, {...sample, sampleId: "next", date: "20240626134458"});
  responses[0](response(hours(10, 11, 12)));
  responses[1](response([Date.UTC(2024, 5, 26, 10) / 1000,
    Date.UTC(2024, 5, 26, 11) / 1000, Date.UTC(2024, 5, 26, 12) / 1000]));
  await settled();
  assert.match(root.textContent, /22\.0 °C/);
  assert.match(root.textContent, /2024-06-26/);
  assert.doesNotMatch(root.textContent, /2024-06-25 ·/);
  weather.clear(root);
  assert.equal(root.textContent, "");
});
