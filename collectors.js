/* Read-only collector rankings from a validated Directus snapshot. */
(function () {
  "use strict";

  const PAGE_SIZE = 40;
  const SPECIES_PAGE_SIZE = 25;
  const countFormat = new Intl.NumberFormat("en");
  const validId = (id) => Number.isSafeInteger(id) && id > 0;

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function validBase(value) {
    if (typeof value !== "string") return false;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !!url.hostname && !url.username && !url.password &&
        !url.search && !url.hash && url.href.replace(/\/$/, "") === value;
    } catch { return false; }
  }

  function validate(snapshot, byId, base) {
    if (!validBase(base) || !(byId instanceof Map) || !snapshot ||
        snapshot.source !== base ||
        typeof snapshot.generated_at !== "string" || !Number.isFinite(Date.parse(snapshot.generated_at)) ||
        typeof snapshot.sample_snapshot_generated_at !== "string" ||
        !Number.isFinite(Date.parse(snapshot.sample_snapshot_generated_at)) ||
        !Number.isSafeInteger(snapshot.total_field_rows) || snapshot.total_field_rows < 0 ||
        !Number.isSafeInteger(snapshot.unlinked_named_samples) || snapshot.unlinked_named_samples < 0 ||
        !Array.isArray(snapshot.collectors) || snapshot.total_field_rows < byId.size ||
        snapshot.unlinked_named_samples > snapshot.total_field_rows) {
      throw new Error("Invalid collector snapshot");
    }
    const people = new Map();
    const seenFields = new Set();
    for (const collector of snapshot.collectors) {
      if (!collector || !validId(collector.id) || people.has(collector.id) ||
          typeof collector.name !== "string" || !collector.name.trim() ||
          !Array.isArray(collector.field_ids) || !collector.field_ids.length) {
        throw new Error("Invalid collector entry");
      }
      let previous = 0;
      for (const id of collector.field_ids) {
        const row = byId.get(id);
        if (!validId(id) || id <= previous || seenFields.has(id) ||
            !Array.isArray(row) || row.length < 9 || row[0] !== id ||
            typeof row[1] !== "string" || !row[1].trim()) {
          throw new Error("Collector sample does not match published Field_Data");
        }
        previous = id;
        seenFields.add(id);
      }
      people.set(collector.id, collector);
    }
    if (seenFields.size + snapshot.unlinked_named_samples > snapshot.total_field_rows) {
      throw new Error("Collector totals exceed exported Field_Data");
    }
    return people;
  }

  function create({leaderboardRoot, detailRoot, snapshot, byId, directusBase, resolveSpecies,
    renderScientificTaxon, loadLeaflet} = {}) {
    if (typeof resolveSpecies !== "function" || typeof renderScientificTaxon !== "function" ||
        typeof loadLeaflet !== "function" ||
        !(leaderboardRoot instanceof Element) || !(detailRoot instanceof Element)) {
      throw new TypeError("Collector views require roots and taxonomy/map helpers");
    }
    let people;
    try { people = validate(snapshot, byId, directusBase); } catch { people = null; }
    const ordered = people ? [...people.values()].sort((a, b) =>
      b.field_ids.length - a.field_ids.length || a.name.localeCompare(b.name) || a.id - b.id) : [];
    let activeMap;
    function hide() {
      activeMap?.destroy();
      activeMap = null;
    }

    function unavailable(root) {
      root.replaceChildren(node("p", "collectors__message", "Collector data is unavailable. Please try again later."));
    }

    function leaderboard() {
      if (!people) { unavailable(leaderboardRoot); return; }
      const section = node("section", "collectors");
      section.append(node("p", "collectors__note",
        `Counts include only published Field_Data samples linked to a People record. ${countFormat.format(snapshot.unlinked_named_samples)} samples have a recorded collector name but no People link and are excluded, not attributed by spelling.`));
      if (!ordered.length) {
        section.append(node("p", "collectors__message", "No linked collector samples are available."));
      } else {
        const list = node("ol", "collectors__list");
        const maximum = ordered[0].field_ids.length;
        for (const collector of ordered) {
          const item = node("li", "collectors__item");
          const card = node("a", "collectors__card");
          card.href = `#collector/${collector.id}`;
          card.append(node("strong", "collectors__name", collector.name),
            node("span", "collectors__identity", `People ID ${collector.id}`),
            node("span", "collectors__count", `${countFormat.format(collector.field_ids.length)} linked ${collector.field_ids.length === 1 ? "sample" : "samples"}`));
          const track = node("span", "collectors__track");
          track.setAttribute("aria-hidden", "true");
          const bar = node("span", "collectors__bar");
          bar.style.width = `${100 * collector.field_ids.length / maximum}%`;
          track.append(bar);
          card.append(track);
          item.append(card);
          list.append(item);
        }
        section.append(list);
      }
      section.append(node("p", "collectors__source",
        `Source: Directus Field_Data and People · Exported ${snapshot.generated_at.slice(0, 10)}.`));
      leaderboardRoot.replaceChildren(section);
    }

    function detail(id) {
      hide();
      const collector = people && people.get(id);
      if (!collector) {
        detailRoot.replaceChildren(node("p", "collectors__message", people ?
          "Collector not found." : "Collector data is unavailable. Please try again later."));
        return false;
      }
      const speciesById = new Map();
      const observations = [];
      for (const fieldId of collector.field_ids) {
        const row = byId.get(fieldId);
        const taxon = row[7] == null ? null : resolveSpecies(row[7]);
        if (!taxon) continue;
        if (!validId(taxon[0]) || taxon[4] !== "species") throw new Error("Invalid Taxa species ancestor");
        if (!speciesById.has(taxon[0])) speciesById.set(taxon[0], {taxon, field_ids: []});
        speciesById.get(taxon[0]).field_ids.push(fieldId);
        observations.push({row, taxon});
      }
      const species = [...speciesById.values()].sort((a, b) =>
        b.field_ids.length - a.field_ids.length || a.taxon[2].localeCompare(b.taxon[2]) || a.taxon[0] - b.taxon[0]);
      let speciesPage = 0;
      let samplePage = 0;
      let selectedSpecies = null;
      const section = node("section", "collectors collectors__detail");
      const back = node("a", "collectors__back", "← All collectors");
      back.href = "#collectors";
      section.append(back, node("h2", null, collector.name),
        node("p", "collectors__identity", `People ID ${collector.id} · ${countFormat.format(collector.field_ids.length)} linked ${collector.field_ids.length === 1 ? "sample" : "samples"}`));
      const person = node("a", "collectors__source", "People record in Directus ↗ (curator login may be required)");
      person.href = `${directusBase}/admin/content/People/${collector.id}`;
      person.target = "_blank";
      person.rel = "noopener noreferrer";
      section.append(person);
      const controls = node("div", "collectors__tabs");
      controls.setAttribute("role", "group");
      controls.setAttribute("aria-label", "Collector exploration");
      const views = new Map();
      for (const [key, label] of [["species", "Species list"], ["map", "Species map"], ["samples", "Field samples"]]) {
        const button = node("button", `collectors__tab collectors__tab--${key}`, label);
        button.type = "button";
        button.addEventListener("click", () => selectView(key));
        controls.append(button);
        views.set(key, button);
      }
      section.append(controls);
      const speciesPanel = node("section", "collectors__species-panel");
      speciesPanel.setAttribute("aria-label", "Resolved species recorded by this collector");
      speciesPanel.append(node("p", "collectors__note",
        `${countFormat.format(species.length)} distinct Taxa species across ${countFormat.format(observations.length)} linked field samples. ${countFormat.format(collector.field_ids.length - observations.length)} samples lack a resolved species in Taxa and are excluded from the species views, but remain in Field samples. Identifications below species rank follow their Taxa parent lineage.`));
      const speciesList = node("ol", "collectors__species-list");
      const speciesPager = node("nav", "collectors__pager");
      speciesPager.setAttribute("aria-label", "Collector species pages");
      const previousSpecies = node("button", null, "← Previous species");
      previousSpecies.type = "button";
      const speciesPosition = node("span", null);
      speciesPosition.setAttribute("aria-live", "polite");
      const nextSpecies = node("button", null, "Next species →");
      nextSpecies.type = "button";
      speciesPager.append(previousSpecies, speciesPosition, nextSpecies);
      speciesPanel.append(speciesList, speciesPager);
      const mapPanel = node("section", "collectors__map-panel");
      mapPanel.setAttribute("aria-label", "Collector species observation map");
      mapPanel.append(node("p", "collectors__note",
        "The map shows resolved species samples with valid recorded GeoJSON points; records without coordinates remain in the lists. Selecting Map loads Leaflet from unpkg and OpenStreetMap tiles."));
      const mapRoot = node("div", "collectors__map-root");
      mapPanel.append(mapRoot);
      const samplesPanel = node("section", "collectors__samples-panel");
      samplesPanel.setAttribute("aria-label", "Field samples linked to this collector");
      const sampleScope = node("div", "collectors__sample-scope");
      const sampleList = node("ul", "collectors__samples");
      const samplePager = node("nav", "collectors__pager");
      samplePager.setAttribute("aria-label", "Collector samples pages");
      const previousSample = node("button", null, "← Previous samples");
      previousSample.type = "button";
      const samplePosition = node("span", null);
      samplePosition.setAttribute("aria-live", "polite");
      const nextSample = node("button", null, "Next samples →");
      nextSample.type = "button";
      samplePager.append(previousSample, samplePosition, nextSample);
      samplesPanel.append(sampleScope, sampleList, samplePager);
      section.append(speciesPanel, mapPanel, samplesPanel);

      function renderSpeciesPage() {
        const count = Math.max(1, Math.ceil(species.length / SPECIES_PAGE_SIZE));
        const items = [];
        for (const entry of species.slice(speciesPage * SPECIES_PAGE_SIZE, (speciesPage + 1) * SPECIES_PAGE_SIZE)) {
          const item = node("li", "collectors__species");
          const link = node("a", "collectors__species-link");
          link.href = `#species/${entry.taxon[0]}`;
          renderScientificTaxon(link, entry.taxon);
          item.append(link, node("strong", "collectors__species-count",
            `${countFormat.format(entry.field_ids.length)} ${entry.field_ids.length === 1 ? "sample" : "samples"}`));
          const track = node("span", "collectors__track");
          track.setAttribute("aria-hidden", "true");
          const bar = node("span", "collectors__bar");
          bar.style.width = `${100 * entry.field_ids.length / species[0].field_ids.length}%`;
          track.append(bar);
          item.append(track);
          const samples = node("button", "collectors__species-samples",
            `View ${countFormat.format(entry.field_ids.length)} collector ${entry.field_ids.length === 1 ? "sample" : "samples"}`);
          samples.type = "button";
          samples.addEventListener("click", () => {
            selectedSpecies = entry;
            samplePage = 0;
            selectView("samples");
          });
          item.append(samples);
          items.push(item);
        }
        speciesList.replaceChildren(...items);
        speciesPosition.textContent = `Page ${speciesPage + 1} of ${count}`;
        previousSpecies.disabled = speciesPage === 0;
        nextSpecies.disabled = speciesPage === count - 1;
      }

      function renderSamplePage() {
        const ids = selectedSpecies ? selectedSpecies.field_ids : collector.field_ids;
        const count = Math.ceil(ids.length / PAGE_SIZE);
        sampleScope.replaceChildren();
        if (selectedSpecies) {
          const scope = node("span", null);
          sampleScope.append(scope);
          scope.append("Showing this collector's samples of ");
          renderScientificTaxon(scope, selectedSpecies.taxon);
          scope.append(" · ");
          const clear = node("button", "collectors__clear-filter", "Show all field samples");
          clear.type = "button";
          clear.addEventListener("click", () => {
            selectedSpecies = null;
            samplePage = 0;
            renderSamplePage();
          });
          sampleScope.append(clear);
        } else sampleScope.append(node("p", "collectors__note", "All field samples linked to this Directus collector, including unresolved identifications."));
        const cards = [];
        for (const fieldId of ids.slice(samplePage * PAGE_SIZE, (samplePage + 1) * PAGE_SIZE)) {
          const row = byId.get(fieldId);
          const card = node("li", "collectors__sample");
          const dashboard = node("a", "collectors__sample-link", row[1]);
          dashboard.href = `#sample/${fieldId}`;
          card.append(dashboard, node("span", "collectors__sample-id", `Field_Data ID ${fieldId}`),
            node("span", "collectors__sample-meta", `Recorded field name: ${row[3] || "Not recorded"} · Garden / project: ${row[2] || "Not recorded"} · Date: ${row[6] || "Not recorded"}`));
          const source = node("a", "collectors__sample-source", "Field_Data in Directus ↗");
          source.href = `${directusBase}/admin/content/Field_Data/${fieldId}`;
          source.target = "_blank";
          source.rel = "noopener noreferrer";
          card.append(source);
          cards.push(card);
        }
        sampleList.replaceChildren(...cards);
        samplePosition.textContent = `Page ${samplePage + 1} of ${count} · ${countFormat.format(ids.length)} samples`;
        previousSample.disabled = samplePage === 0;
        nextSample.disabled = samplePage === count - 1;
      }

      function selectView(view) {
        if (view !== "map") hide();
        speciesPanel.hidden = view !== "species";
        mapPanel.hidden = view !== "map";
        samplesPanel.hidden = view !== "samples";
        for (const [key, button] of views) button.setAttribute("aria-pressed", String(key === view));
        if (view === "map" && !activeMap) activeMap = window.DBGICollectorMap.mount({
          root: mapRoot, observations, loadLeaflet, renderScientificTaxon,
        });
        if (view === "samples") renderSamplePage();
      }
      previousSpecies.addEventListener("click", () => { if (speciesPage > 0) { speciesPage--; renderSpeciesPage(); } });
      nextSpecies.addEventListener("click", () => {
        if (speciesPage < Math.ceil(species.length / SPECIES_PAGE_SIZE) - 1) { speciesPage++; renderSpeciesPage(); }
      });
      previousSample.addEventListener("click", () => { if (samplePage > 0) { samplePage--; renderSamplePage(); } });
      nextSample.addEventListener("click", () => {
        const count = Math.ceil((selectedSpecies || collector).field_ids.length / PAGE_SIZE);
        if (samplePage < count - 1) { samplePage++; renderSamplePage(); }
      });
      renderSpeciesPage();
      detailRoot.replaceChildren(section);
      selectView("species");
      return true;
    }

    return Object.freeze({leaderboard, detail, hide});
  }

  window.DBGICollectors = Object.freeze({create});
})();
