"use strict";

// Specimen processing is linked by Directus IDs and container FKs, not by names or status.
window.DBGIProcessing = (() => {
  const columns = ["kind", "id", "field_id", "container_id", "container_label", "parent_container_id", "status"];
  const collections = {dried: "Dried_Samples_Data", extract: "Extraction_Data",
    aliquot: "Aliquoting_Data", ms: "MS_Data"};
  const stages = Object.keys(collections);
  const validId = (id) => Number.isSafeInteger(id) && id > 0;

  function baseUrl(base) {
    if (typeof base !== "string") return null;
    try {
      const url = new URL(base);
      if (url.protocol !== "https:" || !url.hostname || url.username || url.password ||
          url.search || url.hash) return null;
      return url.href.replace(/\/$/, "");
    } catch (_) {
      return null;
    }
  }

  function buildIndex(snapshot, fieldsById, directusBase) {
    const base = baseUrl(directusBase);
    if (!base || !snapshot || snapshot.source !== `${base}/items/` ||
        !Array.isArray(snapshot.columns) || snapshot.columns.length !== columns.length ||
        snapshot.columns.some((column, index) => column !== columns[index]) ||
        !Array.isArray(snapshot.records) || !(fieldsById instanceof Map)) {
      throw new Error("Invalid Directus processing snapshot");
    }
    const byField = new Map();
    const containerById = new Map();
    const seen = new Set();
    for (const entry of snapshot.records) {
      if (!Array.isArray(entry) || entry.length !== columns.length ||
          !Object.hasOwn(collections, entry[0]) || !validId(entry[1]) ||
          !validId(entry[2]) ||
          (entry[0] === "ms" ? entry[3] !== null || entry[4] !== null :
            !validId(entry[3]) || typeof entry[4] !== "string" || !entry[4].trim()) ||
          (entry[5] !== null && !validId(entry[5])) ||
          (entry[6] !== null && typeof entry[6] !== "string")) {
        throw new Error("Invalid processing record");
      }
      const [kind, id, fieldId, containerId] = entry;
      const key = `${kind}:${id}`;
      if (seen.has(key)) throw new Error("Duplicate processing record ID");
      seen.add(key);
      const field = fieldsById.get(fieldId);
      if (!Array.isArray(field) || field[0] !== fieldId || field.length < 2) {
        throw new Error("Processing record references missing Field_Data snapshot row");
      }
      if (containerId !== null) {
        if (containerById.has(containerId)) throw new Error("Duplicate processing container ID");
        containerById.set(containerId, entry);
      }
      if (!byField.has(fieldId)) byField.set(fieldId, []);
      byField.get(fieldId).push(entry);
    }
    for (const records of byField.values()) {
      records.sort((left, right) => stages.indexOf(left[0]) - stages.indexOf(right[0]) || left[1] - right[1]);
      for (const entry of records) {
        const parent = containerById.get(entry[5]);
        if (!parent) continue;
        if (parent[2] !== entry[2]) {
          throw new Error("Processing parent container belongs to a different Field_Data sample");
        }
        if (stages.indexOf(parent[0]) > stages.indexOf(entry[0])) {
          throw new Error("Invalid processing parent stage association");
        }
      }
    }
    const checked = new Set();
    for (const records of byField.values()) for (const entry of records) {
      if (checked.has(entry)) continue;
      const path = new Set();
      let current = entry;
      while (current && !checked.has(current)) {
        if (path.has(current)) throw new Error("Cyclic processing parent containers");
        path.add(current);
        current = containerById.get(current[5]);
      }
      for (const record of path) checked.add(record);
    }
    return {byField, fieldsById, containerById, directusBase: base};
  }

  function element(tag, className, parent, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    parent.append(node);
    return node;
  }

  function itemLink(parent, base, collection, id, label) {
    if (!base) return element("span", "", parent, label);
    const link = element("a", "", parent, label);
    link.href = `${base}/admin/content/${collection}/${encodeURIComponent(String(id))}`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.referrerPolicy = "no-referrer";
    link.setAttribute("aria-label", `Open ${collection} record ${id} in Directus (opens in a new tab)`);
    return link;
  }

  function card(parent, entry, children, base, parentRecord) {
    const [kind, id, , containerId, containerLabel, parentId, status] = entry;
    const article = element("article", `processing-card processing-card--${kind}`, parent);
    const heading = element("h4", "processing-card-title", article);
    const stage = {dried: "Dried sample", extract: "Extract", aliquot: "Aliquot", ms: "MS record"}[kind];
    heading.append(`${stage} · `);
    itemLink(heading, base, collections[kind], id, `${collections[kind]} #${id}`);
    const details = element("dl", "processing-card-details", article);
    if (containerId !== null) {
      element("dt", "", details, "Container");
      const value = element("dd", "", details);
      itemLink(value, base, "Containers", containerId, `${containerLabel} (#${containerId})`);
    }
    if (parentId !== null && !parentRecord) {
      element("dt", "", details, "Recorded parent container");
      const value = element("dd", "", details);
      itemLink(value, base, "Containers", parentId, `#${parentId}`);
    }
    element("dt", "", details, "Recorded status");
    element("dd", "", details, status === null ? "Not recorded" : status);
    if (children.length) {
      const group = element("div", "processing-children", article);
      for (const child of children) card(group, child.entry, child.children, base, entry);
    }
  }
  function render(root, {row, index, directusBase} = {}) {
    root.replaceChildren();
    root.className = "processing-panel";
    root.setAttribute("aria-label", "Field sample specimen processing");
    element("h3", "processing-title", root, "Specimen processing");
    if (!index || !(index.byField instanceof Map) || !(index.fieldsById instanceof Map) ||
        !(index.containerById instanceof Map) || !Array.isArray(row) || !validId(row[0]) ||
        baseUrl(directusBase) !== index.directusBase) {
      element("p", "processing-message", root, "Processing snapshot unavailable.");
      return;
    }
    const stored = index.fieldsById.get(row[0]);
    if (!Array.isArray(stored) || stored[0] !== row[0] || stored[1] !== row[1]) {
      element("p", "processing-message", root, "Field sample processing data unavailable.");
      return;
    }
    const records = index.byField.get(row[0]) || [];
    if (!records.length) {
      element("p", "processing-message", root, "No linked processing records for this field sample.");
      return;
    }
    const nodes = new Map(records.map((entry) => [entry, {entry, children: []}]));
    const roots = [];
    for (const entry of records) {
      const parent = index.containerById.get(entry[5]);
      if (parent && nodes.has(parent)) nodes.get(parent).children.push(nodes.get(entry));
      else roots.push(nodes.get(entry));
    }
    const group = element("div", "processing-roots", root);
    for (const node of roots) card(group, node.entry, node.children, index.directusBase, null);
  }

  return Object.freeze({buildIndex, render});
})();
