"use strict";

// Observation subjects are recorded text from Directus Field_Data, never inferred from Taxa.
window.DBGIObservationSubject = (() => {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const paths = Object.freeze({
    leaf: "M20 4C10 4 4 8 4 15a5 5 0 0 0 5 5c7 0 11-6 11-16ZM4 20c2-5 6-9 12-12",
    flower: "M12 10c-5-7-3-9 0-9s5 2 0 9Zm2 2c7-5 9-3 9 0s-2 5-9 0Zm-2 2c5 7 3 9 0 9s-5-2 0-9Zm-2-2c-7 5-9 3-9 0s2-5 9 0Zm0 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0Z",
    root: "M12 2v12m0 0-6 4m6-4 6 4M6 18l-3 4m3-4v4m12-4 3 4m-3-4v4",
    stem: "M12 22V4m0 7c-5 0-7-3-7-6 5 0 7 2 7 6Zm0 5c5 0 7-3 7-6-5 0-7 2-7 6Z",
    fruit: "M12 6c-4-3-9 0-9 6 0 5 3 10 7 10 1 0 1-.5 2-.5s1 .5 2 .5c4 0 7-5 7-10 0-6-5-9-9-6Zm0 0c0-3 1-4 4-5m-4 5c2-4 5-4 7-3-1 2-3 3-7 3Z",
    seed: "M19 3C11 3 5 7 5 14c0 4 2 7 5 7 6 0 9-8 9-18ZM5 20c2-4 5-7 10-11",
    bud: "M12 2c-5 5-7 8-7 12a7 7 0 0 0 14 0c0-4-2-7-7-12Zm0 20V12m0 5-4-4m4 4 4-4",
    bark: "M6 2h12v20H6zM10 5v5m4-2v7m-4-1v5",
    whole: "M12 22V9m0 7-5-5m5 2 5-5M12 3a7 7 0 0 0-7 7c0 3 3 6 7 6s7-3 7-6a7 7 0 0 0-7-7Z",
    unknown: "M12 3v18m-6-6 6 6 6-6M5 4h14",
  });
  const icons = Object.freeze({
    leaf: "leaf", flower: "flower", stems: "stem", root: "root",
    "whole organism": "whole", fruit: "fruit", seed: "seed", bark: "bark",
    bud: "bud", aboveground: "whole",
  });

  function iconFor(recorded) {
    const iconName = icons[recorded.toLocaleLowerCase()] || "unknown";
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.75");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", paths[iconName]);
    svg.append(path);
    return svg;
  }

  function inline(parent, subject) {
    if (typeof subject !== "string" || !subject.trim()) return;
    const recorded = subject.trim();
    const marker = document.createElement("span");
    marker.className = "sample-subject__mark";
    marker.setAttribute("role", "img");
    marker.setAttribute("aria-label", `Observation subject: ${recorded}`);
    marker.title = `Observation subject: ${recorded}`;
    marker.append(iconFor(recorded));
    parent.append(marker);
  }

  function cell(subject) {
    const td = document.createElement("td");
    td.className = "sample-subject__cell";
    if (typeof subject !== "string" || !subject.trim()) {
      td.textContent = "—";
    } else {
      inline(td, subject);
      const label = document.createElement("span");
      label.textContent = subject.trim();
      td.append(label);
    }
    return td;
  }

  function matches(subject, selected) {
    if (!selected) return true;
    const normalized = typeof subject === "string" ? subject.trim().toLocaleLowerCase() : "";
    return selected === "missing:" ? !normalized : selected === `value:${normalized}`;
  }

  function populate(select, records) {
    const available = new Map();
    let missing = false;
    for (const row of records) {
      const subject = row[9];
      const value = typeof subject === "string" ? subject.trim() : "";
      if (!value) missing = true;
      else if (!available.has(value.toLocaleLowerCase())) available.set(value.toLocaleLowerCase(), value);
    }
    const option = (label, value) => {
      const item = document.createElement("option");
      item.value = value;
      item.textContent = label;
      return item;
    };
    const labels = {leaf: "Leaf", flower: "Flower", root: "Root", stems: "Stems", fruit: "Fruit",
      seed: "Seed", bark: "Bark", bud: "Bud", "whole organism": "Whole organism", aboveground: "Aboveground"};
    select.replaceChildren(option("All subjects", ""));
    for (const key of [...available.keys()].sort((a, b) => a.localeCompare(b))) {
      select.append(option(labels[key] || available.get(key), `value:${key}`));
    }
    if (missing) select.append(option("Not recorded", "missing:"));
    select.value = "";
  }

  function show(root, subject) {
    root.replaceChildren();
    root.hidden = true;
    if (typeof subject !== "string" || !subject.trim()) return;
    const recorded = subject.trim();
    const svg = iconFor(recorded);
    const text = document.createElement("span");
    const title = document.createElement("span");
    title.className = "sample-subject__label";
    title.textContent = "Observation subject";
    const value = document.createElement("strong");
    value.textContent = recorded;
    text.append(title, value);
    root.append(svg, text);
    root.hidden = false;
  }

  return Object.freeze({show, inline, cell, matches, populate});
})();
