"use strict";

// Selection is keyed by MS_Data ID, never by a filename or a taxon name.
// The index is built exclusively from the published Directus snapshots.
window.MSCompare = (() => {
  const selectedIds = new Set();
  const selectedGroups = new Map();
  const pageSize = 40;
  let refreshMapping = null;

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
    if (!Array.isArray(profile) || profile.length !== 6 || !validId(profile[0]) ||
        profile[1] !== fieldId || !validId(profile[2]) ||
        !["OK", "published"].includes(profile[3]) ||
        !window.GNPSDashboard?.mzmlName(profile[4]) ||
        !(index.instruments instanceof Map) || !index.instruments.has(profile[2]) ||
        !(index.injectionMethods instanceof Map) ||
        (profile[5] !== null && !index.injectionMethods.has(profile[5]))) return false;
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

  function filesForField(fieldId, index) {
    if (!validId(fieldId) || !(index?.byField instanceof Map)) return [];
    return (index.byField.get(fieldId) || []).filter((profile) => usable(profile, fieldId, index))
      .sort((a, b) => a[0] - b[0]);
  }
  function eligibleFile(fieldId, fileId, index) {
    if (!validId(fieldId) || !validId(fileId) || !(index?.byField instanceof Map)) return false;
    for (const profile of index.byField.get(fieldId) || []) {
      if (Array.isArray(profile) && profile[0] === fileId && usable(profile, fieldId, index)) return true;
    }
    return false;
  }


  function selectFile(fieldId, fileId, index) {
    if (!eligibleFile(fieldId, fileId, index)) return false;
    selectedIds.add(fileId);
    if (!selectedGroups.has(fileId)) selectedGroups.set(fileId, "A");
    return true;
  }

  function removeFile(fieldId, fileId, index) {
    if (!eligibleFile(fieldId, fileId, index)) return false;
    selectedGroups.delete(fileId);
    return selectedIds.delete(fileId);
  }

  function scientificName(row, taxaById) {
    const taxon = taxaById?.get(row[7]);
    if (!Array.isArray(taxon) || taxon[0] !== row[7] || typeof taxon[2] !== "string" || !taxon[2]) {
      return "Unresolved taxon";
    }
    return [taxon[2], taxon[3]].filter(Boolean).join(" ");
  }

  function render(root, {index, rowsById, taxaById, directusBase, mapping} = {}) {
    refreshMapping = null;
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
    for (const id of selectedIds) if (!byId.has(id)) { selectedIds.delete(id); selectedGroups.delete(id); }
    const tray = element("section", root, null, "ms-compare-tray");
    element("h3", tray, "Selected files");
    const trayStatus = element("p", tray, null, "ms-compare-status");
    trayStatus.setAttribute("aria-live", "polite");
    const clear = element("button", tray, "Clear selection", "ms-compare-clear");
    clear.type = "button";
    const selectedList = element("ul", tray, null, "ms-compare-selected");
    const searchSection = element("section", root, null, "ms-compare-search");
    element("h3", searchSection, "Find Directus MS files");
    const form = element("form", searchSection, null, "ms-compare-search-form");
    const label = element("label", form, "Search sample ID, Field_Data ID, resolved scientific name, filename or instrument");
    const search = element("input", label);
    search.type = "search";
    search.autocomplete = "off";
    search.value = "";
    const submit = element("button", form, "Search files");
    submit.type = "submit";
    const resultsStatus = element("p", searchSection, "Enter a search term to find Directus MS files.", "ms-compare-results-status");
    resultsStatus.setAttribute("aria-live", "polite");
    const results = element("ul", searchSection, null, "ms-compare-results");
    results.hidden = true;
    const pages = element("nav", searchSection, null, "ms-compare-pages");
    pages.setAttribute("aria-label", "MS file search pages");
    const previous = element("button", pages, "Previous");
    previous.type = "button";
    const pageLabel = element("span", pages);
    const next = element("button", pages, "Next");
    next.type = "button";
    pages.hidden = true;
    const research = element("section", root, null, "ms-compare-research");
    element("h3", research, "Find metabolites in LOTUS");
    element("p", research, "Choose a selected file’s resolved species, or search LOTUS without a taxon. LOTUS literature annotations are not compounds detected in these MS files.", "ms-compare-note");
    const lotusForm = element("form", research, null, "ms-compare-lotus-form");
    const speciesLabel = element("label", lotusForm, "LOTUS taxon search");
    const speciesSelect = element("select", speciesLabel);
    const lotusButton = element("button", lotusForm, "Launch LOTUS search");
    lotusButton.type = "submit";
    const lotusRoot = element("div", research, null, "ms-compare-lotus");
    lotusRoot.hidden = true;
    const calculator = element("section", root, null, "ms-compare-calculator");
    calculator.hidden = true;
    let currentMapping = mapping;
    let speciesOptions = new Map();
    let userSelectedScope = false;
    let activeLotusScope = null;
    let lotusOpened = false;
    let calculatorReady = false;
    let comparisonMz = "";
    refreshMapping = (updated) => {
      currentMapping = updated;
      if (lotusOpened) launchLOTUS();
    };
    function clearLOTUS() {
      lotusRoot.replaceChildren();
      lotusRoot.hidden = true;
      lotusOpened = false;
      activeLotusScope = null;
    }
    function launchLOTUS() {
      const taxon = speciesOptions.get(Number(speciesSelect.value));
      window.Metabolome.render(lotusRoot, {taxon, taxaById, mapping: currentMapping, manual: true, comparison: true});
      activeLotusScope = speciesSelect.value;
      lotusOpened = true;
    }
    function updateSpeciesChoices(chosen) {
      const previous = speciesSelect.value;
      const next = new Map();
      for (const entry of chosen) {
        const taxon = taxaById.get(entry.row[7]);
        if (taxon?.[0] !== entry.row[7]) continue;
        const species = window.Metabolome.speciesAncestor(taxon, taxaById);
        if (species) next.set(species[0], species);
      }
      speciesOptions = next;
      speciesSelect.replaceChildren();
      const manual = element("option", speciesSelect, "Unscoped LOTUS search");
      manual.value = "manual";
      for (const species of [...next.values()].sort((a, b) => (a[2] || "").localeCompare(b[2] || ""))) {
        const option = element("option", speciesSelect, [species[2], species[3]].filter(Boolean).join(" "));
        option.value = String(species[0]);
      }
      speciesSelect.value = next.has(Number(previous)) ? previous
        : !userSelectedScope && next.size === 1 ? String(next.keys().next().value) : "manual";
      if (activeLotusScope !== null && activeLotusScope !== speciesSelect.value) clearLOTUS();
    }
    speciesSelect.addEventListener("change", () => {
      userSelectedScope = true;
      if (activeLotusScope !== speciesSelect.value) clearLOTUS();
    });
    lotusForm.addEventListener("submit", (event) => {
      event.preventDefault();
      launchLOTUS();
    });
    const gnps = element("section", root, null, "ms-compare-dashboard");
    let page = 0;
    let activeQuery = null;
    let pageCount = 1;

    function description(entry, parent) {
      const {row, profile, instrument} = entry;
      element("span", parent, entry.filename, "ms-compare-filename");
      window.MSProfile.appendPolarity(parent, profile, index.injectionMethods);
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
      if (!chosen.length) comparisonMz = "";
      let firstGroup = 0;
      for (const entry of chosen) if (selectedGroups.get(entry.id) !== "B") firstGroup++;
      trayStatus.textContent = `${chosen.length} ${chosen.length === 1 ? "file" : "files"} selected · Group A: ${firstGroup} · Group B: ${chosen.length - firstGroup}` +
        (chosen.length && !firstGroup ? " · Add a file to group A to open GNPS2." : "");
      clear.disabled = !chosen.length;
      if (!chosen.length) element("li", selectedList, "No files selected. Search below to add files from any field sample.");
      for (const entry of chosen) {
        const item = element("li", selectedList);
        description(entry, item);
        const groupLabel = element("label", item, `GNPS2 group for MS_Data #${entry.id}`, "ms-compare-group");
        const groupSelect = element("select", groupLabel);
        for (const group of ["A", "B"]) {
          const option = element("option", groupSelect, `Group ${group}`);
          option.value = group;
        }
        groupSelect.value = selectedGroups.get(entry.id) === "B" ? "B" : "A";
        groupSelect.addEventListener("change", () => {
          selectedGroups.set(entry.id, groupSelect.value === "B" ? "B" : "A");
          updateSelection();
          updateResults();
        });
        const remove = element("button", item, `Remove MS_Data #${entry.id}`);
        remove.type = "button";
        remove.addEventListener("click", () => {
          selectedIds.delete(entry.id);
          selectedGroups.delete(entry.id);
          updateSelection();
          updateResults();
        });
      }
      window.GNPSDashboard.render(gnps, {profiles: chosen.map((entry) => entry.profile),
        selectedIds: chosen.map((entry) => entry.id), groupById: selectedGroups,
        injectionMethods: index.injectionMethods, initialMz: comparisonMz,
        onMzChange: (mz) => { comparisonMz = mz; }});
      updateSpeciesChoices(chosen);
      if (firstGroup && !calculatorReady) {
        window.ChemCalc.render(calculator, {comparison: true});
        calculatorReady = true;
      } else if (!firstGroup && calculatorReady) {
        calculator.replaceChildren();
        calculator.hidden = true;
        calculatorReady = false;
      }
    }

    function updateResults() {
      if (!activeQuery) {
        results.replaceChildren();
        results.hidden = true;
        pages.hidden = true;
        return;
      }
      const matches = entries.filter((entry) => {
        const {row, instrument} = entry;
        return [String(row[0]), row[1], scientificName(row, taxaById), entry.filename,
          instrument.model, instrument.code].some((value) => value.toLocaleLowerCase().includes(activeQuery));
      });
      results.hidden = false;
      pages.hidden = false;
      pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
      page = Math.min(page, pageCount - 1);
      results.replaceChildren();
      for (const entry of matches.slice(page * pageSize, (page + 1) * pageSize)) {
        const item = element("li", results);
        description(entry, item);
        for (const group of ["A", "B"]) {
          const current = selectedIds.has(entry.id) && (selectedGroups.get(entry.id) || "A") === group;
          const add = element("button", item,
            current ? `In group ${group}` : `${selectedIds.has(entry.id) ? "Move" : "Add"} MS_Data #${entry.id} to group ${group}`);
          add.type = "button";
          add.disabled = current;
          add.addEventListener("click", () => {
            selectedIds.add(entry.id);
            selectedGroups.set(entry.id, group);
            updateSelection();
            updateResults();
          });
        }
      }
      resultsStatus.textContent = `${matches.length} usable ${matches.length === 1 ? "file" : "files"} found`;
      pageLabel.textContent = `Page ${page + 1} of ${pageCount}`;
      previous.disabled = page === 0;
      next.disabled = page + 1 === pageCount;
    }

    clear.addEventListener("click", () => {
      selectedIds.clear();
      selectedGroups.clear();
      updateSelection();
      updateResults();
    });
    search.addEventListener("input", () => {
      activeQuery = null; page = 0;
      resultsStatus.textContent = "Press Search files to show matching Directus MS files.";
      updateResults();
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      activeQuery = search.value.trim().toLocaleLowerCase() || null;
      page = 0;
      if (!activeQuery) resultsStatus.textContent = "Enter a search term to find Directus MS files.";
      updateResults();
    });
    previous.addEventListener("click", () => { if (page > 0) { page--; updateResults(); } });
    next.addEventListener("click", () => { if (page + 1 < pageCount) { page++; updateResults(); } });
    updateSelection();
    updateResults();
  }

  return Object.freeze({filesForField, selectFile, removeFile, isSelected: (id) => selectedIds.has(id),
    render, updateMapping: (mapping) => refreshMapping?.(mapping),
    unmount: () => { refreshMapping = null; }, selectionCount: () => selectedIds.size});
})();
