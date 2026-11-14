"use strict";

// Selection is keyed by MS_Data ID, never by a filename or a taxon name.
// The index is built exclusively from the published Directus snapshots.
window.MSCompare = (() => {
  const selectedIds = new Set();
  const pageSize = 40;
  const validId = (id) => Number.isSafeInteger(id) && id > 0;

  function element(tag, parent, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    parent.append(node);
    return node;
  }

  function directusLink(parent, base, collection, id, label) {
    let href;
    try {
      const url = new URL(base);
      if (url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash) {
        href = `${url.href.replace(/\/$/, "")}/admin/content/${collection}/${encodeURIComponent(String(id))}`;
      }
    } catch (_) { /* Missing Directus URL: keep the provenance label. */ }
    if (!href) return element("span", parent, label);
    const link = element("a", parent, label);
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.referrerPolicy = "no-referrer";
    return link;
  }

  function usable(profile, fieldId, index) {
    if (!Array.isArray(profile) || profile.length !== 5 || !validId(profile[0]) ||
        profile[1] !== fieldId || !validId(profile[2]) ||
        !["OK", "published"].includes(profile[3]) ||
        !window.GNPSDashboard?.mzmlName(profile[4]) ||
        !(index.instruments instanceof Map) || !index.instruments.has(profile[2])) return false;
    const row = index.rowsById?.get(fieldId);
    return Array.isArray(row) && row[0] === fieldId && typeof row[1] === "string" && !!row[1].trim();
  }

  function entriesFor(index) {
    if (!(index?.byField instanceof Map) || !(index.rowsById instanceof Map)) return [];
    const entries = [];
    const ids = new Set();
    for (const [fieldId, profiles] of index.byField) {
      if (!validId(fieldId) || !Array.isArray(profiles)) continue;
      for (const profile of profiles) {
        if (!usable(profile, fieldId, index) || ids.has(profile[0])) continue;
        ids.add(profile[0]);
        entries.push({id: profile[0], profile, row: index.rowsById.get(fieldId),
          filename: window.GNPSDashboard.mzmlName(profile[4]),
          instrument: index.instruments.get(profile[2])});
      }
    }
    return entries;
  }

  // Whether a field has any usable Directus file for a compare button.
  function hasField(fieldId, index) {
    return validId(fieldId) && Array.isArray(index?.byField?.get(fieldId)) &&
      index.byField.get(fieldId).some((profile) => usable(profile, fieldId, index));
  }

  // Returns the count of newly selected MS_Data IDs.
  function addField(fieldId, index) {
    if (!validId(fieldId) || !(index?.byField instanceof Map) ||
        !(index.rowsById instanceof Map)) return 0;
    const profiles = index.byField.get(fieldId);
    if (!Array.isArray(profiles)) return 0;
    let added = 0;
    for (const profile of profiles) {
      if (usable(profile, fieldId, index) && !selectedIds.has(profile[0])) {
        selectedIds.add(profile[0]);
        added++;
      }
    }
    return added;
  }

  function scientificName(row, taxaById) {
    const taxon = taxaById?.get(row[7]);
    if (!Array.isArray(taxon) || taxon[0] !== row[7] || typeof taxon[2] !== "string" || !taxon[2]) {
      return "Unresolved taxon";
    }
    return [taxon[2], taxon[3]].filter(Boolean).join(" ");
  }

  function render(root, {index, rowsById, taxaById, directusBase} = {}) {
    root.replaceChildren();
    root.className = "ms-compare";
    element("p", root, "Files and sample/taxon associations come from the published Directus MS_Data, Field_Data and Taxa snapshots. GNPS2 dataset MSV000102993 is an assumed location for these mzML filenames; remote file presence has not been verified.", "ms-compare-note");
    if (!(index?.byField instanceof Map) || !(index.rowsById instanceof Map) ||
        !(index.instruments instanceof Map) || !(taxaById instanceof Map) ||
        (rowsById != null && !(rowsById instanceof Map))) {
      element("p", root, "Directus MS profiles unavailable.", "ms-compare-note");
      return;
    }
    // index.rowsById was validated when the MS snapshot was built. Do not
    // replace its field associations with caller-supplied or guessed rows.
    const entries = entriesFor(index);
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    for (const id of selectedIds) if (!byId.has(id)) selectedIds.delete(id);
    const tray = element("section", root, null, "ms-compare-tray");
    element("h3", tray, "Selected files");
    const trayStatus = element("p", tray, null, "ms-compare-status");
    trayStatus.setAttribute("aria-live", "polite");
    const clear = element("button", tray, "Clear selection", "ms-compare-clear");
    clear.type = "button";
    const selectedList = element("ul", tray, null, "ms-compare-selected");
    const searchSection = element("section", root, null, "ms-compare-search");
    element("h3", searchSection, "Find Directus MS files");
    const label = element("label", searchSection, "Search sample ID, Field_Data ID, resolved scientific name, filename or instrument");
    const search = element("input", label);
    search.type = "search";
    search.autocomplete = "off";
    search.value = "";
    const resultsStatus = element("p", searchSection, null, "ms-compare-results-status");
    resultsStatus.setAttribute("aria-live", "polite");
    const results = element("ul", searchSection, null, "ms-compare-results");
    const pages = element("nav", searchSection, null, "ms-compare-pages");
    pages.setAttribute("aria-label", "MS file search pages");
    const previous = element("button", pages, "Previous");
    previous.type = "button";
    const pageLabel = element("span", pages);
    const next = element("button", pages, "Next");
    next.type = "button";
    const gnps = element("section", root, null, "ms-compare-dashboard");
    let page = 0;
    let pageCount = 1;

    function description(entry, parent) {
      const {row, profile, instrument} = entry;
      element("span", parent, entry.filename, "ms-compare-filename");
      const details = element("span", parent, null, "ms-compare-details");
      details.append(` · ${row[1]} · `);
      const taxon = taxaById.get(row[7]);
      if (taxon?.[0] === row[7]) window.DBGIScientificNames.append(details, taxon[2], taxon[4], taxon[3]);
      else details.append("Unresolved taxon");
      details.append(` · ${instrument.model} (${instrument.code}) · `);
      const sample = element("a", details, `Field_Data #${row[0]}`);
      sample.href = `#sample/${row[0]}`;
      details.append(" · ");
      directusLink(details, directusBase, "MS_Data", entry.id, `MS_Data #${entry.id}`);
      details.append(" · ");
      directusLink(details, directusBase, "Field_Data", row[0], "Field_Data source");
      details.append(" · ");
      directusLink(details, directusBase, "Instruments", profile[2], `Instrument #${profile[2]}`);
    }

    function updateSelection() {
      selectedList.replaceChildren();
      const chosen = [...selectedIds].map((id) => byId.get(id));
      trayStatus.textContent = `${chosen.length} ${chosen.length === 1 ? "file" : "files"} selected`;
      clear.disabled = !chosen.length;
      if (!chosen.length) element("li", selectedList, "No files selected. Search below to add files from any field sample.");
      for (const entry of chosen) {
        const item = element("li", selectedList);
        description(entry, item);
        const remove = element("button", item, `Remove MS_Data #${entry.id}`);
        remove.type = "button";
        remove.addEventListener("click", () => {
          selectedIds.delete(entry.id);
          updateSelection();
          updateResults();
        });
      }
      window.GNPSDashboard.render(gnps, {profiles: chosen.map((entry) => entry.profile),
        selectedIds: chosen.map((entry) => entry.id)});
    }

    function updateResults() {
      const query = search.value.trim().toLocaleLowerCase();
      const matches = query ? entries.filter((entry) => {
        const {row, instrument} = entry;
        return [String(row[0]), row[1], scientificName(row, taxaById), entry.filename,
          instrument.model, instrument.code].some((value) => value.toLocaleLowerCase().includes(query));
      }) : entries;
      pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
      page = Math.min(page, pageCount - 1);
      results.replaceChildren();
      for (const entry of matches.slice(page * pageSize, (page + 1) * pageSize)) {
        const item = element("li", results);
        description(entry, item);
        const add = element("button", item, selectedIds.has(entry.id) ? "Selected" : `Add MS_Data #${entry.id}`);
        add.type = "button";
        add.disabled = selectedIds.has(entry.id);
        add.addEventListener("click", () => {
          selectedIds.add(entry.id);
          updateSelection();
          updateResults();
        });
      }
      resultsStatus.textContent = `${matches.length} usable ${matches.length === 1 ? "file" : "files"} found`;
      pageLabel.textContent = `Page ${page + 1} of ${pageCount}`;
      previous.disabled = page === 0;
      next.disabled = page + 1 === pageCount;
    }

    clear.addEventListener("click", () => {
      selectedIds.clear();
      updateSelection();
      updateResults();
    });
    search.addEventListener("input", () => { page = 0; updateResults(); });
    previous.addEventListener("click", () => { if (page > 0) { page--; updateResults(); } });
    next.addEventListener("click", () => { if (page + 1 < pageCount) { page++; updateResults(); } });
    updateSelection();
    updateResults();
  }

  return Object.freeze({hasField, addField, render, selectionCount: () => selectedIds.size});
})();
