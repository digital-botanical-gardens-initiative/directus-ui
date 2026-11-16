"use strict";

// MS evidence is tied to Field_Data by the exporter, never to a name or a filename.
window.MSProfile = (() => {
  const source = "https://emi-collection.unifr.ch/directus/items/";
  const validId = (id) => Number.isSafeInteger(id) && id > 0;

  function speciesAncestor(taxonId, taxaById) {
    const seen = new Set();
    while (taxonId != null && !seen.has(taxonId)) {
      seen.add(taxonId);
      const taxon = taxaById.get(taxonId);
      if (!Array.isArray(taxon) || taxon[0] !== taxonId) return null;
      if (taxon[4] === "species") return taxon;
      taxonId = taxon[5];
    }
    return null;
  }

  function buildIndex(snapshot, rowsById, taxaById) {
    if (snapshot?.source !== source || !Array.isArray(snapshot.instruments) ||
        !Array.isArray(snapshot.injection_methods) || !Array.isArray(snapshot.profiles) ||
        !(rowsById instanceof Map) || !(taxaById instanceof Map)) {
      throw new Error("Invalid Directus MS profile snapshot");
    }

    const instruments = new Map();
    for (const entry of snapshot.instruments) {
      if (!Array.isArray(entry) || entry.length !== 3 || !validId(entry[0]) ||
          typeof entry[1] !== "string" || !entry[1].trim() ||
          typeof entry[2] !== "string" || !entry[2].trim() || instruments.has(entry[0])) {
        throw new Error("Invalid or duplicate MS instrument");
      }
      instruments.set(entry[0], {id: entry[0], code: entry[1], model: entry[2]});
    }
    const injectionMethods = new Map();
    for (const entry of snapshot.injection_methods) {
      if (!Array.isArray(entry) || entry.length !== 2 || !validId(entry[0]) ||
          !["positive", "negative", null].includes(entry[1]) || injectionMethods.has(entry[0])) {
        throw new Error("Invalid or duplicate Directus injection method");
      }
      injectionMethods.set(entry[0], entry[1]);
    }

    const byField = new Map();
    const bySpecies = new Map();
    const speciesByField = new Map();
    const seenMS = new Set();
    for (const entry of snapshot.profiles) {
      if (!Array.isArray(entry) || entry.length !== 6 || !validId(entry[0]) ||
          !validId(entry[1]) || !validId(entry[2]) ||
          !["OK", "published"].includes(entry[3]) || seenMS.has(entry[0]) ||
          !instruments.has(entry[2]) ||
          (entry[5] !== null && (!validId(entry[5]) || !injectionMethods.has(entry[5]))) ||
          (entry[4] !== null && (typeof entry[4] !== "string" || !entry[4].trim() ||
            entry[4] === "." || entry[4] === ".." || /[/\\\x00-\x1f\x7f]/.test(entry[4])))) {
        throw new Error("Invalid or duplicate MS profile record");
      }
      const field = rowsById.get(entry[1]);
      if (!Array.isArray(field) || field[0] !== entry[1] || field.length < 9) {
        throw new Error("MS profile references a missing Field_Data snapshot row");
      }
      if (!speciesByField.has(entry[1])) {
        if (field[7] != null && !taxaById.has(field[7])) {
          throw new Error("MS profile references a missing Taxa snapshot row");
        }
        speciesByField.set(entry[1], speciesAncestor(field[7], taxaById));
      }
      seenMS.add(entry[0]);
      if (!byField.has(entry[1])) byField.set(entry[1], []);
      byField.get(entry[1]).push(entry);
      const species = speciesByField.get(entry[1]);
      if (species) {
        if (!bySpecies.has(species[0])) {
          bySpecies.set(species[0], {fieldIds: new Set(), instrumentIds: new Set()});
        }
        const group = bySpecies.get(species[0]);
        group.fieldIds.add(entry[1]);
        group.instrumentIds.add(entry[2]);
      }
    }
    return {instruments, injectionMethods, byField, bySpecies, rowsById};
  }

  function element(tag, className, parent, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    parent.append(node);
    return node;
  }

  function itemLink(parent, directusBase, collection, id, label, description) {
    if (!directusBase) return element("span", "", parent, label);
    const anchor = element("a", "", parent, label);
    anchor.href = `${directusBase.replace(/\/$/, "")}/admin/content/${collection}/${encodeURIComponent(String(id))}`;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.referrerPolicy = "no-referrer";
    anchor.setAttribute("aria-label", `${description} (opens in a new tab)`);
    return anchor;
  }

  function appendPolarity(parent, profile, injectionMethods) {
    const id = profile?.[5];
    if (!validId(id) || !(injectionMethods instanceof Map)) return null;
    const polarity = injectionMethods.get(id);
    if (polarity !== "positive" && polarity !== "negative") return null;
    const badge = element("span", `ms-polarity-badge ms-polarity-badge--${polarity}`,
      parent, polarity === "positive" ? "+" : "−");
    badge.title = `${polarity === "positive" ? "Positive" : "Negative"} ionization · Directus Injection_Methods #${id}`;
    badge.setAttribute("aria-label", badge.title);
    return badge;
  }

  function render(root, {row, taxaById, index, directusBase} = {}) {
    root.replaceChildren();
    root.className = "ms-profile";
    root.setAttribute("aria-label", "Mass spectrometry profile status");
    const status = element("p", "ms-profile-status", root);
    const badge = element("span", "ms-profile-badge", status);
    if (!index || !(taxaById instanceof Map) || !Array.isArray(row) ||
        !(index.rowsById instanceof Map)) {
      badge.textContent = "MS profile data unavailable";
      return;
    }
    const stored = index.rowsById.get(row[0]);
    if (!stored || stored[0] !== row[0] || stored[1] !== row[1] || stored[7] !== row[7]) {
      badge.textContent = "Field sample MS profile status unknown";
      return;
    }
    const species = speciesAncestor(row[7], taxaById);
    const own = index.byField.get(row[0]) || [];
    if (!species) {
      badge.textContent = "Species unresolved · MS profile status unknown";
    } else {
      const group = index.bySpecies.get(species[0]);
      if (!group) {
        badge.textContent = "No linked MS file recorded";
        const scope = element("span", "ms-profile-scope", status, " for species ");
        window.DBGIScientificNames.append(scope, species[2], species[4]);
        status.append(" in this snapshot.");
      } else {
        badge.className += " ms-profile-badge--recorded";
        badge.textContent = "MS profile recorded";
        const scope = element("span", "ms-profile-scope", status, " for species ");
        window.DBGIScientificNames.append(scope, species[2], species[4]);
        element("p", "ms-profile-count", root,
          `${group.fieldIds.size} distinct linked field ${group.fieldIds.size === 1 ? "sample" : "samples"} of this species.`);
        const instruments = element("p", "ms-profile-instruments", root, "Instruments: ");
        let first = true;
        for (const id of group.instrumentIds) {
          if (!first) instruments.append(" · ");
          first = false;
          const instrument = index.instruments.get(id);
          const label = `${instrument.model} (${instrument.code})`;
          itemLink(instruments, directusBase, "Instruments", id, label,
            `Open ${label} instrument record in Directus`);
        }
      }
    }
    if (own.length) {
      const sample = element("p", "ms-profile-sample", root,
        `This field sample: ${own.length} linked MS ${own.length === 1 ? "file" : "files"} · `);
      own.forEach((record, position) => {
        if (position) sample.append(" · ");
        itemLink(sample, directusBase, "MS_Data", record[0], `MS_Data #${record[0]}`,
          `Open MS_Data record ${record[0]} for this field sample in Directus`);
        appendPolarity(sample, record, index.injectionMethods);
      });
    } else if (species && index.bySpecies.has(species[0])) {
      element("p", "ms-profile-sample", root,
        "This field sample: No linked MS file recorded. The species-wide profile is from other field samples.");
    }
  }

  return Object.freeze({buildIndex, render, appendPolarity});
})();
