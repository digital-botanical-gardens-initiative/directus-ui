"use strict";

// Font Awesome Free 6.7.2 SVG icon paths, Copyright 2024 Fonticons, Inc.
// Icons: CC BY 4.0 https://creativecommons.org/licenses/by/4.0/
// Source and licence: https://fontawesome.com/license/free (sun path adapted slightly).
(function () {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const ICONS = {
    sun: ["0 0 512 512", "M361.5 1.2c5 2.1 8.6 6.6 9.6 11.9L391 121l107.9 19.8c5.3 1 9.8 4.6 11.9 9.6s1.5 10.7-1.6 15.2L446.9 256l62.3 90.3c3.1 4.5 3.7 10.2 1.6 15.2s-6.6 8.6-11.9 9.6L391 391 371.1 498.9c-1 5.3-4.6 9.8-9.6 11.9s-10.7 1.5-15.2-1.6L256 446.9l-90.3 62.3c-4.5 3.1-10.2 3.7-15.2 1.6s-8.6-6.6-9.6-11.9L121 391 13.1 371.1c-5.3-1-9.8-4.6-11.9-9.6s-1.5-10.7 1.6-15.2L65.1 256 2.8 165.7c-3.1-4.5-3.7-10.2-1.6-15.2s6.6-8.6 11.9-9.6L121 121 140.9 13.1c1-5.3 4.6-9.8 9.6-11.9s10.7-1.5 15.2 1.6L256 65.1 346.3 2.8c4.5-3.2 10.3-3.8 15.2-1.6zM160 256a96 96 0 1 1 192 0 96 96 0 1 1 -192 0zm224 0a128 128 0 1 0 -256 0 128 128 0 1 0 256 0z"],
    cloudSun: ["0 0 640 512", "M294.2 1.2c5.1 2.1 8.7 6.7 9.6 12.1l14.1 84.7 84.7 14.1c5.4 .9 10 4.5 12.1 9.6s1.5 10.9-1.6 15.4l-38.5 55c-2.2-.1-4.4-.2-6.7-.2c-23.3 0-45.1 6.2-64 17.1l0-1.1c0-53-43-96-96-96s-96 43-96 96s43 96 96 96c8.1 0 15.9-1 23.4-2.9c-36.6 18.1-63.3 53.1-69.8 94.9l-24.4 17c-4.5 3.2-10.3 3.8-15.4 1.6s-8.7-6.7-9.6-12.1L98.1 317.9 13.4 303.8c-5.4-.9-10-4.5-12.1-9.6s-1.5-10.9 1.6-15.4L52.5 208 2.9 137.2c-3.2-4.5-3.8-10.3-1.6-15.4s6.7-8.7 12.1-9.6L98.1 98.1l14.1-84.7c.9-5.4 4.5-10 9.6-12.1s10.9-1.5 15.4 1.6L208 52.5 278.8 2.9c4.5-3.2 10.3-3.8 15.4-1.6zM144 208a64 64 0 1 1 128 0 64 64 0 1 1 -128 0zM639.9 431.9c0 44.2-35.8 80-80 80l-271.9 0c-53 0-96-43-96-96c0-47.6 34.6-87 80-94.6l0-1.3c0-53 43-96 96-96c34.9 0 65.4 18.6 82.2 46.4c13-9.1 28.8-14.4 45.8-14.4c44.2 0 80 35.8 80 80c0 5.9-.6 11.7-1.9 17.2c37.4 6.7 65.8 39.4 65.8 78.7z"],
    cloud: ["0 0 640 512", "M0 336c0 79.5 64.5 144 144 144l368 0c70.7 0 128-57.3 128-128c0-61.9-44-113.6-102.4-125.4c4.1-10.7 6.4-22.4 6.4-34.6c0-53-43-96-96-96c-19.7 0-38.1 6-53.3 16.2C367 64.2 315.3 32 256 32C167.6 32 96 103.6 96 192c0 2.7 .1 5.4 .2 8.1C40.2 219.8 0 273.2 0 336z"],
    fog: ["0 0 640 512", "M32 144c0 79.5 64.5 144 144 144l123.3 0c22.6 19.9 52.2 32 84.7 32s62.1-12.1 84.7-32l27.3 0c61.9 0 112-50.1 112-112s-50.1-112-112-112c-10.7 0-21 1.5-30.8 4.3C443.8 27.7 401.1 0 352 0c-32.6 0-62.4 12.2-85.1 32.3C242.1 12.1 210.5 0 176 0C96.5 0 32 64.5 32 144zM616 368l-336 0c-13.3 0-24 10.7-24 24s10.7 24 24 24l336 0c13.3 0 24-10.7 24-24s-10.7-24-24-24zm-64 96l-112 0c-13.3 0-24 10.7-24 24s10.7 24 24 24l112 0c13.3 0 24-10.7 24-24s-10.7-24-24-24zm-192 0L24 464c-13.3 0-24 10.7-24 24s10.7 24 24 24l336 0c13.3 0 24-10.7 24-24s-10.7-24-24-24zM224 392c0-13.3-10.7-24-24-24L96 368c-13.3 0-24 10.7-24 24s10.7 24 24 24l104 0c13.3 0 24-10.7 24-24z"],
    rain: ["0 0 512 512", "M96 320c-53 0-96-43-96-96c0-42.5 27.6-78.6 65.9-91.2C64.7 126.1 64 119.1 64 112C64 50.1 114.1 0 176 0c43.1 0 80.5 24.3 99.2 60c14.7-17.1 36.5-28 60.8-28c44.2 0 80 35.8 80 80c0 5.5-.6 10.8-1.6 16c.5 0 1.1 0 1.6 0c53 0 96 43 96 96s-43 96-96 96L96 320zm-6.8 52c1.3-2.5 3.9-4 6.8-4s5.4 1.5 6.8 4l35.1 64.6c4.1 7.5 6.2 15.8 6.2 24.3l0 3c0 26.5-21.5 48-48 48s-48-21.5-48-48l0-3c0-8.5 2.1-16.9 6.2-24.3L89.2 372zm160 0c1.3-2.5 3.9-4 6.8-4s5.4 1.5 6.8 4l35.1 64.6c4.1 7.5 6.2 15.8 6.2 24.3l0 3c0 26.5-21.5 48-48 48s-48-21.5-48-48l0-3c0-8.5 2.1-16.9 6.2-24.3L249.2 372zm124.9 64.6L409.2 372c1.3-2.5 3.9-4 6.8-4s5.4 1.5 6.8 4l35.1 64.6c4.1 7.5 6.2 15.8 6.2 24.3l0 3c0 26.5-21.5 48-48 48s-48-21.5-48-48l0-3c0-8.5 2.1-16.9 6.2-24.3z"],
    snow: ["0 0 448 512", "M224 0c17.7 0 32 14.3 32 32l0 30.1 15-15c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9l-49 49 0 70.3 61.4-35.8 17.7-66.1c3.4-12.8 16.6-20.4 29.4-17s20.4 16.6 17 29.4l-5.2 19.3 23.6-13.8c15.3-8.9 34.9-3.7 43.8 11.5s3.8 34.9-11.5 43.8l-25.3 14.8 21.7 5.8c12.8 3.4 20.4 16.6 17 29.4s-16.6 20.4-29.4 17l-67.7-18.1L287.5 256l60.9 35.5 67.7-18.1c12.8-3.4 26 4.2 29.4 17s-4.2 26-17 29.4l-21.7 5.8 25.3 14.8c15.3 8.9 20.4 28.5 11.5 43.8s-28.5 20.4-43.8 11.5l-23.6-13.8 5.2 19.3c3.4 12.8-4.2 26-17 29.4s-26-4.2-29.4-17l-17.7-66.1L256 311.7l0 70.3 49 49c9.4 9.4 9.4 24.6 0 33.9s-24.6 9.4-33.9 0l-15-15 0 30.1c0 17.7-14.3 32-32 32s-32-14.3-32-32l0-30.1-15 15c-9.4 9.4-24.6 9.4-33.9 0s-9.4-24.6 0-33.9l49-49 0-70.3-61.4 35.8-17.7 66.1c-3.4 12.8-16.6 20.4-29.4 17s-20.4-16.6-17-29.4l5.2-19.3L48.1 395.6c-15.3 8.9-34.9 3.7-43.8-11.5s-3.7-34.9 11.5-43.8l25.3-14.8-21.7-5.8c-12.8-3.4-20.4-16.6-17-29.4s16.6-20.4 29.4-17l67.7 18.1L160.5 256 99.6 220.5 31.9 238.6c-12.8 3.4-26-4.2-29.4-17s4.2-26 17-29.4l21.7-5.8L15.9 171.6C.6 162.7-4.5 143.1 4.4 127.9s28.5-20.4 43.8-11.5l23.6 13.8-5.2-19.3c-3.4-12.8 4.2-26 17-29.4s26 4.2 29.4 17l17.7 66.1L192 200.3l0-70.3L143 81c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0l15 15L192 32c0-17.7 14.3-32 32-32z"],
    thunder: ["0 0 512 512", "M0 224c0 53 43 96 96 96l47.2 0L290 202.5c17.6-14.1 42.6-14 60.2 .2s22.8 38.6 12.8 58.8L333.7 320l18.3 0 64 0c53 0 96-43 96-96s-43-96-96-96c-.5 0-1.1 0-1.6 0c1.1-5.2 1.6-10.5 1.6-16c0-44.2-35.8-80-80-80c-24.3 0-46.1 10.9-60.8 28C256.5 24.3 219.1 0 176 0C114.1 0 64 50.1 64 112c0 7.1 .7 14.1 1.9 20.8C27.6 145.4 0 181.5 0 224zm330.1 3.6c-5.8-4.7-14.2-4.7-20.1-.1l-160 128c-5.3 4.2-7.4 11.4-5.1 17.8s8.3 10.7 15.1 10.7l70.1 0L177.7 488.8c-3.4 6.7-1.6 14.9 4.3 19.6s14.2 4.7 20.1 .1l160-128c5.3-4.2 7.4-11.4 5.1-17.8s-8.3-10.7-15.1-10.7l-70.1 0 52.4-104.8c3.4-6.7 1.6-14.9-4.2-19.6z"],
  };
  const CONDITIONS = {
    0: ["Clear sky", "sun"], 1: ["Mainly clear", "sun"],
    2: ["Partly cloudy", "cloudSun"], 3: ["Overcast", "cloud"],
    45: ["Fog", "fog"], 48: ["Depositing rime fog", "fog"],
    51: ["Light drizzle", "rain"], 53: ["Moderate drizzle", "rain"], 55: ["Dense drizzle", "rain"],
    56: ["Light freezing drizzle", "rain"], 57: ["Dense freezing drizzle", "rain"],
    61: ["Slight rain", "rain"], 63: ["Moderate rain", "rain"], 65: ["Heavy rain", "rain"],
    66: ["Light freezing rain", "rain"], 67: ["Heavy freezing rain", "rain"],
    71: ["Slight snowfall", "snow"], 73: ["Moderate snowfall", "snow"],
    75: ["Heavy snowfall", "snow"], 77: ["Snow grains", "snow"],
    80: ["Slight rain showers", "rain"], 81: ["Moderate rain showers", "rain"],
    82: ["Violent rain showers", "rain"], 85: ["Slight snow showers", "snow"],
    86: ["Heavy snow showers", "snow"], 95: ["Thunderstorm", "thunder"],
    96: ["Thunderstorm with slight hail", "thunder"],
    97: ["Heavy thunderstorm", "thunder"],
    99: ["Thunderstorm with heavy hail", "thunder"],
  };
  const active = new WeakMap();

  function element(tag, text, parent, className) {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    parent.append(node);
    return node;
  }

  function link(parent, label, url) {
    const anchor = element("a", label, parent);
    anchor.href = url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    return anchor;
  }

  function dateParts(date) {
    if (typeof date !== "string" || !/^\d{14}$/.test(date)) return null;
    const [year, month, day, hour, minute, second] = [
      date.slice(0, 4), date.slice(4, 6), date.slice(6, 8),
      date.slice(8, 10), date.slice(10, 12), date.slice(12, 14),
    ].map(Number);
    if (year < 1940 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31 ||
        hour > 23 || minute > 59 || second > 59) return null;
    const utc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    if (utc.getUTCFullYear() !== year || utc.getUTCMonth() + 1 !== month ||
        utc.getUTCDate() !== day || utc.getUTCHours() !== hour) return null;
    return {date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
      hour: date.slice(8, 10), minute: date.slice(10, 12), utc};
  }

  function validCoordinate(value, limit) {
    return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit;
  }

  function requestUrl(parts, latitude, longitude) {
    const url = new URL("https://archive-api.open-meteo.com/v1/archive");
    // Open-Meteo's historical utc_offset_seconds is fixed at request time, even across DST.
    // Adjacent days ensure the sample's local day is covered when historic offset differs.
    const start = new Date(Math.max(parts.utc.getTime() - 86400000, Date.UTC(1940, 0, 1))).toISOString().slice(0, 10);
    const end = new Date(parts.utc.getTime() + 86400000).toISOString().slice(0, 10);
    for (const [key, value] of Object.entries({latitude, longitude, start_date: start,
      end_date: end, hourly: "temperature_2m,relative_humidity_2m,weather_code",
      temperature_unit: "celsius", timezone: "auto", timeformat: "unixtime"})) {
      url.searchParams.set(key, value);
    }
    return url;
  }

  function localHour(formatter, timestamp) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp * 1000))
      .map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}`;
  }

  function selectEstimate(payload, parts) {
    const hourly = payload?.hourly;
    const times = hourly?.time;
    if (!Array.isArray(times) || !Array.isArray(hourly.temperature_2m) ||
        !Array.isArray(hourly.relative_humidity_2m) || !Array.isArray(hourly.weather_code) ||
        times.length !== hourly.temperature_2m.length ||
        times.length !== hourly.relative_humidity_2m.length ||
        times.length !== hourly.weather_code.length || typeof payload.timezone !== "string" ||
        payload.hourly_units?.time !== "unixtime" ||
        payload.hourly_units?.temperature_2m !== "°C" ||
        payload.hourly_units?.relative_humidity_2m !== "%") {
      throw new Error("Invalid archive response");
    }
    const formatter = new Intl.DateTimeFormat("en-CA", {timeZone: payload.timezone,
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23"});
    const wanted = `${parts.date}T${parts.hour}`;
    let index = -1;
    for (let i = 0; i < times.length; i++) {
      if (!Number.isSafeInteger(times[i]) || localHour(formatter, times[i]) !== wanted) continue;
      if (index !== -1) return {ambiguous: true}; // Two different instants on a DST fall-back hour.
      index = i;
    }
    if (index < 0) return null;
    const temperature = hourly.temperature_2m[index];
    const humidity = hourly.relative_humidity_2m[index];
    const code = hourly.weather_code[index];
    if (typeof temperature !== "number" || !Number.isFinite(temperature) ||
        typeof humidity !== "number" || !Number.isFinite(humidity) || humidity < 0 || humidity > 100 ||
        !Number.isInteger(code)) return null;
    return {temperature, humidity, code, timezone: payload.timezone};
  }

  function icon(parent, name) {
    const [viewBox, path] = ICONS[name];
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", viewBox);
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.classList.add("sample-weather__icon");
    const shape = document.createElementNS(SVG_NS, "path");
    shape.setAttribute("d", path);
    svg.append(shape);
    parent.append(svg);
  }

  function showEstimate(parent, estimate, parts) {
    const condition = CONDITIONS[estimate.code];
    const description = condition?.[0] || `Weather code ${estimate.code} (description unavailable)`;
    const card = element("div", "", parent, "sample-weather__result");
    const visual = element("div", "", card, "sample-weather__condition");
    if (condition) icon(visual, condition[1]);
    element("strong", description, visual);
    const measures = element("dl", "", card, "sample-weather__measures");
    for (const [label, value] of [["Temperature at 2 m", `${estimate.temperature.toFixed(1)} °C`],
      ["Relative humidity at 2 m", `${Math.round(estimate.humidity)} %`]]) {
      const measure = element("div", "", measures);
      element("dt", label, measure);
      element("dd", value, measure);
    }
    element("p", `${parts.date} · ${parts.hour}:00–${parts.hour}:59 (${estimate.timezone}); recorded at ${parts.hour}:${parts.minute}.`, card, "sample-weather__time");
    return description;
  }

  function clear(root) {
    active.get(root)?.abort();
    active.delete(root);
    root.replaceChildren();
  }

  function render(root, {date, latitude, longitude} = {}) {
    clear(root);
    const state = {abort: () => {}};
    active.set(root, state);
    root.classList.add("sample-weather");
    element("h3", "Weather at collection", root);
    const status = element("p", "", root, "sample-weather__status");
    status.setAttribute("role", "status");
    const parts = dateParts(date);
    const located = validCoordinate(latitude, 90) && validCoordinate(longitude, 180);
    if (!parts || !located || parts.utc.getTime() > Date.now() + 86400000) {
      status.textContent = !located && !parts ? "Weather unavailable: no valid collection timestamp or coordinates." :
        !parts || parts.utc.getTime() > Date.now() + 86400000 ? "Weather unavailable: no valid historical collection timestamp." :
          "Weather unavailable: no valid coordinates.";
      return;
    }
    const results = element("div", "", root);
    const credit = element("p", "", root, "sample-weather__credit");
    link(credit, "Weather: Open-Meteo.com", "https://open-meteo.com/");
    credit.append(" · ");
    link(credit, "Historical archive", "https://open-meteo.com/en/docs/historical-weather-api");
    credit.append(" · ");
    link(credit, "CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/");
    credit.append(" · ");
    link(credit, "Adapted Font Awesome Free icons", "https://fontawesome.com/license/free");
    const details = element("details", "", root, "sample-weather__details");
    element("summary", "Source, privacy & limitations", details);
    element("p", "Opening a sample with a valid date and location automatically sends its coordinates and a three-day date window to Open-Meteo, which also sees your IP address. The sample ID is not sent.", details, "sample-weather__privacy");
    element("p", "The recorded date has no time zone; we assume its clock time was local to the coordinates. This is an hourly gridded model/reanalysis estimate, not a measurement or confirmation of conditions at the moment of collection. Open-Meteo uses ERA5, ERA5-Land and ECMWF IFS; the response does not identify the model for this hour.", details, "sample-weather__caveat");
    element("p", "Presentation adapted: temperature and humidity rounded; WMO codes described and illustrated; sun path adapted.", details, "sample-weather__caveat");

    async function load() {
      const controller = new AbortController();
      state.abort();
      state.abort = () => controller.abort();
      results.replaceChildren();
      status.textContent = "Loading historical weather estimate…";
      try {
        const response = await fetch(requestUrl(parts, latitude, longitude), {
          signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer",
        });
        if (!response.ok) throw new Error("Archive request failed");
        const estimate = selectEstimate(await response.json(), parts);
        if (active.get(root) !== state || controller.signal.aborted) return;
        if (!estimate || estimate.ambiguous) {
          status.textContent = estimate?.ambiguous ?
            "Weather unavailable: this local clock hour occurs twice on the time-zone transition date; the recorded timestamp does not distinguish them." :
            "Weather unavailable: no complete historical estimate for the recorded local hour.";
          return;
        }
        showEstimate(results, estimate, parts);
        status.textContent = "";
      } catch (error) {
        if (active.get(root) !== state || controller.signal.aborted) return;
        status.textContent = "Weather unavailable: the archive could not be reached or returned an invalid response.";
        const retry = element("button", "Try again", results, "sample-weather__button secondary");
        retry.type = "button";
        retry.addEventListener("click", load);
      }
    }
    void load();
  }

  window.SampleWeather = {render, clear};
})();
