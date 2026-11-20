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

  function listControls(title, options, onChange) {
    const group = node("div", "collectors__filters");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", title);
    const searchLabel = node("label", "collectors__filter", "Filter ");
    const search = node("input");
    search.type = "search";
    search.value = "";
    search.setAttribute("aria-label", `Filter ${title.toLowerCase()}`);
    search.addEventListener("input", onChange);
    searchLabel.append(search);
    const sortLabel = node("label", "collectors__filter", "Sort ");
    const sort = node("select");
    sort.setAttribute("aria-label", `Sort ${title.toLowerCase()}`);
    for (const [value, label] of options) {
      const option = node("option", null, label);
      option.value = value;
      sort.append(option);
    }
    sort.value = options[0][0];
    sort.addEventListener("change", onChange);
    sortLabel.append(sort);
    group.append(searchLabel, sortLabel);
    return {group, search, sort};
  }

  function filteredSorted(entries, controls, matches, options, tie) {
    const query = controls.search.value.trim().toLocaleLowerCase();
    const [, , key, descending] = options.find(([value]) => value === controls.sort.value) || options[0];
    return entries.filter(entry => matches(entry).toLocaleLowerCase().includes(query)).sort((a, b) => {
      const left = key(a), right = key(b);
      const order = typeof left === "number" ? left - right : String(left).localeCompare(String(right));
      return (descending ? -order : order) || tie(a, b);
    });
  }

  function validBase(value) {
    if (typeof value !== "string") return false;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !!url.hostname && !url.username && !url.password &&
        !url.search && !url.hash && url.href.replace(/\/$/, "") === value;
    } catch { return false; }
  }

  function profileLinks(collector) {
    const links = node("div", "collectors__profile-links");
    const profiles = [
      [collector.dbgi_profile, "DBGI profile", collector.dbgi_profile],
      [collector.orcid, "ORCID", collector.orcid && `https://orcid.org/${collector.orcid}`],
      [collector.inat, "iNaturalist", collector.inat && `https://www.inaturalist.org/people/${collector.inat}`],
    ];
    for (const [value, label, url] of profiles) {
      if (!value) continue;
      const link = node("a", null, `${label} ↗`);
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.referrerPolicy = "no-referrer";
      links.append(link);
    }
    return links.children.length ? links : null;
  }
  function portrait(collector) {
    const badge = node("span", "collectors__portrait");
    badge.setAttribute("aria-hidden", "true");
    const words = collector.name.trim().split(/\s+/);
    const initials = [words[0], words.length > 1 ? words.at(-1) : ""]
      .filter(Boolean).map((word) => Array.from(word)[0].toLocaleUpperCase()).join("");
    badge.append(node("span", null, initials));
    if (collector.portrait) {
      const image = node("img");
      image.src = collector.portrait;
      image.alt = "";
      image.width = 88;
      image.height = 88;
      image.loading = "lazy";
      image.decoding = "async";
      image.title = `Portrait from ${collector.dbgi_profile} · DBGI website content CC BY 4.0`;
      image.addEventListener("error", () => image.remove());
      badge.append(image);
    }
    return badge;
  }
  function portraitCredit() {
    const credit = node("p", "collectors__photo-credit", "Portraits from ");
    const source = node("a", null, "DBGI team profiles");
    source.href = "https://www.dbgi.org/network/";
    const license = node("a", null, "CC BY 4.0");
    license.href = "https://creativecommons.org/licenses/by/4.0/";
    for (const link of [source, license]) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.referrerPolicy = "no-referrer";
    }
    credit.append(source, " · DBGI website content ", license);
    return credit;
  }
  function validate(snapshot, byId, base) {
    if (!validBase(base) || !(byId instanceof Map) || !snapshot ||
        snapshot.source !== base ||
        typeof snapshot.generated_at !== "string" || !Number.isFinite(Date.parse(snapshot.generated_at)) ||
        typeof snapshot.sample_snapshot_generated_at !== "string" ||
        !Number.isFinite(Date.parse(snapshot.sample_snapshot_generated_at)) ||
        !Number.isSafeInteger(snapshot.total_field_rows) || snapshot.total_field_rows < 0 ||
        (snapshot.unlinked_named_samples !== null &&
          (!Number.isSafeInteger(snapshot.unlinked_named_samples) || snapshot.unlinked_named_samples < 0)) ||
        (snapshot.unlinked_named_samples === null && snapshot.site !== "dbgi") ||
        !Array.isArray(snapshot.collectors) || snapshot.total_field_rows < byId.size ||
        (snapshot.unlinked_named_samples !== null && snapshot.unlinked_named_samples > snapshot.total_field_rows)) {
      throw new Error("Invalid collector snapshot");
    }
    const people = new Map();
    const seenFields = new Set();
    for (const collector of snapshot.collectors) {
      if (!collector || !validId(collector.id) || people.has(collector.id) ||
          typeof collector.name !== "string" || !collector.name.trim() ||
          !Array.isArray(collector.field_ids) || !collector.field_ids.length ||
          (collector.orcid !== undefined && !/^\d{4}-\d{4}-\d{4}-[\dX]{4}$/.test(collector.orcid)) ||
          (collector.inat !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/.test(collector.inat)) ||
          (collector.dbgi_profile !== undefined &&
            !/^https:\/\/www\.dbgi\.org\/team\/[a-z0-9-]+\/$/.test(collector.dbgi_profile)) ||
          (collector.portrait !== undefined &&
            (collector.portrait !== `assets/collectors/${collector.id}.webp` || !collector.dbgi_profile))) {
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
    if (seenFields.size + (snapshot.unlinked_named_samples ?? 0) > snapshot.total_field_rows) {
      throw new Error("Collector totals exceed exported Field_Data");
    }
    return people;
  }

  function create({leaderboardRoot, detailRoot, snapshot, byId, directusBase, gardens, resolveSpecies,
    renderScientificTaxon, loadLeaflet} = {}) {
    if (typeof resolveSpecies !== "function" || typeof renderScientificTaxon !== "function" ||
        typeof loadLeaflet !== "function" ||
        !(leaderboardRoot instanceof Element) || !(detailRoot instanceof Element)) {
      throw new TypeError("Collector views require roots and taxonomy/map helpers");
    }
    let people;
    try {
      people = validate(snapshot, byId, directusBase);
      if (snapshot.site === "dbgi" && (!Array.isArray(gardens?.gardens) ||
          [...byId.values()].some((row) => !gardens.gardens.some((garden) => garden.id === row[2])))) {
        throw new Error("Incomplete botanical garden catalog");
      }
    } catch { people = null; }
    const ordered = people ? [...people.values()].sort((a, b) =>
      b.field_ids.length - a.field_ids.length || a.name.localeCompare(b.name) || a.id - b.id) : [];
    const gardenNames = new Map(gardens?.gardens?.map((garden) => [garden.id, garden.name]));
    const projectName = (id) => snapshot?.site === "dbgi" ? gardenNames.get(id) : id || "Not recorded";
    const projectLabel = snapshot?.site === "dbgi" ? "Garden" : "Project";
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
      section.append(node("p", "collectors__note", snapshot.unlinked_named_samples === null ?
        "Counts include only published garden field samples linked to a People record. The number of samples with a recorded collector name but no People link is unknown within this garden-only snapshot; no names are attributed by spelling." :
        `Counts include only published Field_Data samples linked to a People record. ${countFormat.format(snapshot.unlinked_named_samples)} samples have a recorded collector name but no People link and are excluded, not attributed by spelling.`));
      if (!ordered.length) {
        section.append(node("p", "collectors__message", "No linked collector samples are available."));
      } else {
        const options = [
          ["count-desc", "Samples (most first)", entry => entry.field_ids.length, true],
          ["count-asc", "Samples (fewest first)", entry => entry.field_ids.length, false],
          ["name-asc", "Name (A–Z)", entry => entry.name, false],
          ["name-desc", "Name (Z–A)", entry => entry.name, true],
          ["id-asc", "People ID (low to high)", entry => entry.id, false],
          ["id-desc", "People ID (high to low)", entry => entry.id, true],
        ];
        const list = node("ol", "collectors__list");
        const maximum = ordered[0].field_ids.length;
        const controls = listControls("collectors", options, render);
        section.append(controls.group, list);
        function render() {
          const matches = filteredSorted(ordered, controls, entry =>
            `${entry.name} ${entry.id} ${entry.field_ids.length} ${entry.orcid || ""} ${entry.inat || ""} ${entry.dbgi_profile || ""}`,
            options, (a, b) => a.name.localeCompare(b.name) || a.id - b.id);
          const items = [];
          for (const collector of matches) {
            const item = node("li", "collectors__item");
            const card = node("a", "collectors__card");
            card.href = `#collector/${collector.id}`;
            const heading = node("span", "collectors__card-heading");
            heading.append(portrait(collector), node("strong", "collectors__name", collector.name));
            card.append(heading,
              node("span", "collectors__count", `${countFormat.format(collector.field_ids.length)} linked ${collector.field_ids.length === 1 ? "sample" : "samples"}`));
            const track = node("span", "collectors__track");
            track.setAttribute("aria-hidden", "true");
            const bar = node("span", "collectors__bar");
            bar.style.width = `${100 * collector.field_ids.length / maximum}%`;
            track.append(bar);
            card.append(track);
            item.append(card);
            const profiles = profileLinks(collector);
            if (profiles) item.append(profiles);
            items.push(item);
          }
          list.replaceChildren(...items);
        }
        render();
      }
      section.append(node("p", "collectors__source",
        `Source: Directus Field_Data and People · Exported ${snapshot.generated_at.slice(0, 10)}.`));
      if (ordered.some((collector) => collector.portrait)) section.append(portraitCredit());
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
      let visibleSpecies = [];
      let visibleSamples = [];
      const section = node("section", "collectors collectors__detail");
      const back = node("a", "collectors__back", "← All collectors");
      back.href = "#collectors";
      const header = node("div", "collectors__person-header");
      const identity = node("div", "collectors__person-identity");
      identity.append(node("h2", null, collector.name),
        node("p", "collectors__identity", `${countFormat.format(collector.field_ids.length)} linked ${collector.field_ids.length === 1 ? "sample" : "samples"}`));
      header.append(portrait(collector), identity);
      section.append(back, header);
      const person = node("a", "collectors__source", "People record in Directus ↗ (curator login may be required)");
      person.href = `${directusBase}/admin/content/People/${collector.id}`;
      person.target = "_blank";
      person.rel = "noopener noreferrer";
      section.append(person);
      const profiles = profileLinks(collector);
      if (profiles) section.append(profiles);
      if (collector.portrait) section.append(portraitCredit());
      const controls = node("div", "view-switch collectors__tabs");
      controls.setAttribute("role", "group");
      controls.setAttribute("aria-label", "Collector field-sample display and species summary");
      const views = new Map();
      for (const [key, label] of [["cards", "Cards"], ["list", "List"], ["map", "Map"], ["species", "Species summary"]]) {
        const button = node("button", `collectors__tab collectors__tab--${key}`, label);
        button.type = "button";
        button.addEventListener("click", () => selectView(key));
        controls.append(button);
        views.set(key, button);
      }
      const speciesPanel = node("section", "collectors__species-panel");
      speciesPanel.setAttribute("aria-label", "Resolved species recorded by this collector");
      speciesPanel.append(node("p", "collectors__note",
        `${countFormat.format(species.length)} distinct Taxa species across ${countFormat.format(observations.length)} linked field samples. ${countFormat.format(collector.field_ids.length - observations.length)} samples lack a resolved species in Taxa and are omitted from this species summary. Cards, List and Map include all linked samples. Identifications below species rank follow their Taxa parent lineage.`));
      const speciesOptions = [
        ["count-desc", "Samples (most first)", entry => entry.field_ids.length, true],
        ["count-asc", "Samples (fewest first)", entry => entry.field_ids.length, false],
        ["name-asc", "Scientific name (A–Z)", entry => entry.taxon[2], false],
        ["name-desc", "Scientific name (Z–A)", entry => entry.taxon[2], true],
        ["id-asc", "Taxon ID (low to high)", entry => entry.taxon[0], false],
        ["id-desc", "Taxon ID (high to low)", entry => entry.taxon[0], true],
      ];
      const speciesControls = listControls("collector species", speciesOptions, () => {
        speciesPage = 0;
        renderSpeciesPage();
      });
      speciesPanel.append(speciesControls.group);
      const speciesList = node("ol", "collectors__species-list");
      const speciesPager = node("nav", "pager collectors__pager");
      speciesPager.setAttribute("aria-label", "Collector species pages");
      const previousSpecies = node("button", "secondary", "← Previous");
      previousSpecies.type = "button";
      const speciesPosition = node("span", null);
      speciesPosition.setAttribute("aria-live", "polite");
      const nextSpecies = node("button", "secondary", "Next →");
      nextSpecies.type = "button";
      speciesPager.append(previousSpecies, speciesPosition, nextSpecies);
      speciesPanel.append(speciesList, speciesPager);
      const mapPanel = node("section", "collectors__map-panel");
      mapPanel.setAttribute("aria-label", "Collector field sample map");
      mapPanel.append(node("p", "collectors__note",
        "All matching field samples with recorded GeoJSON coordinates appear on the map, including those without a resolved species. Records without coordinates remain in Cards and List. Selecting Map loads Leaflet from unpkg and OpenStreetMap tiles."));
      const mapRoot = node("div", "collectors__map-root");
      mapPanel.append(mapRoot);
      const samplesPanel = node("section", "collectors__samples-panel");
      samplesPanel.setAttribute("aria-label", "Field-sample cards linked to this collector");
      const sampleOptions = [
        ["id-asc", "Sample ID (low to high)", id => id, false],
        ["id-desc", "Sample ID (high to low)", id => id, true],
        ["name-asc", "Sample name (A–Z)", id => byId.get(id)[1], false],
        ["name-desc", "Sample name (Z–A)", id => byId.get(id)[1], true],
        ["field-asc", "Field name (A–Z)", id => byId.get(id)[3] || "", false],
        ["field-desc", "Field name (Z–A)", id => byId.get(id)[3] || "", true],
        ["project-asc", `${projectLabel} (A–Z)`, id =>
          snapshot.site === "dbgi" ? projectName(byId.get(id)[2]) : byId.get(id)[2] || "", false],
        ["project-desc", `${projectLabel} (Z–A)`, id =>
          snapshot.site === "dbgi" ? projectName(byId.get(id)[2]) : byId.get(id)[2] || "", true],
        ["date-asc", "Date (earliest first)", id => byId.get(id)[6] || "", false],
        ["date-desc", "Date (latest first)", id => byId.get(id)[6] || "", true],
      ];
      const sampleControls = listControls("collector field samples", sampleOptions, refreshSampleResults);
      const subjectLabel = node("label", "collectors__filter", "Observation subject ");
      const subjectFilter = node("select");
      window.DBGIObservationSubject.populate(subjectFilter, collector.field_ids.map((id) => byId.get(id)));
      subjectFilter.addEventListener("change", refreshSampleResults);
      subjectLabel.append(subjectFilter);
      sampleControls.group.append(subjectLabel);
      const sampleList = node("ul", "collectors__samples");
      samplesPanel.append(sampleList);
      const listPanel = node("section", "collectors__list-panel");
      listPanel.setAttribute("aria-label", "Field-sample list linked to this collector");
      const tableScroll = node("div", "table-scroll");
      const table = node("table");
      const tableHead = node("thead");
      const headingRow = node("tr");
      for (const title of ["Sample ID", "Observation subject", "Resolved CoL species", projectLabel, "Collection date"]) {
        const cell = node("th", null, title);
        cell.setAttribute("scope", "col");
        headingRow.append(cell);
      }
      tableHead.append(headingRow);
      const sampleRows = node("tbody");
      table.append(tableHead, sampleRows);
      tableScroll.append(table);
      listPanel.append(tableScroll);
      const sampleScope = node("div", "collectors__sample-scope");
      const samplePager = node("nav", "pager collectors__pager");
      samplePager.setAttribute("aria-label", "Collector samples pages");
      const previousSample = node("button", "secondary", "← Previous");
      previousSample.type = "button";
      const samplePosition = node("span", null);
      samplePosition.setAttribute("aria-live", "polite");
      const nextSample = node("button", "secondary", "Next →");
      nextSample.type = "button";
      samplePager.append(previousSample, samplePosition, nextSample);
      section.append(sampleControls.group, controls, sampleScope, samplesPanel, listPanel, mapPanel, samplePager, speciesPanel);

      function matchingSpecies() {
        return filteredSorted(species, speciesControls, entry =>
          `${entry.taxon[2]} ${entry.taxon[0]} ${entry.field_ids.length}`,
          speciesOptions, (a, b) => a.taxon[2].localeCompare(b.taxon[2]) || a.taxon[0] - b.taxon[0]);
      }

      function matchingSamples() {
        const ids = (selectedSpecies ? selectedSpecies.field_ids : collector.field_ids)
          .filter((fieldId) => window.DBGIObservationSubject.matches(byId.get(fieldId)[9], subjectFilter.value));
        return filteredSorted(ids, sampleControls, fieldId => {
          const row = byId.get(fieldId);
          return `${fieldId} ${row[1]} ${row[3] || ""} ${projectName(row[2])} ${row[6] || ""} ${resolveSpecies(row[7])?.[2] || ""}`;
        }, sampleOptions, (a, b) => a - b);
      }

      function refreshSampleResults() {
        samplePage = 0;
        renderSamplePage();
        if (activeMap) {
          hide();
          selectView("map");
        }
      }

      function renderSpeciesPage() {
        visibleSpecies = matchingSpecies();
        const matches = visibleSpecies;
        const count = Math.max(1, Math.ceil(matches.length / SPECIES_PAGE_SIZE));
        const items = [];
        for (const entry of matches.slice(speciesPage * SPECIES_PAGE_SIZE, (speciesPage + 1) * SPECIES_PAGE_SIZE)) {
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
            selectView("cards");
          });
          item.append(samples);
          items.push(item);
        }
        if (!items.length) items.push(node("li", "collectors__message", "No matching species."));
        speciesList.replaceChildren(...items);
        speciesPosition.textContent = `Page ${speciesPage + 1} of ${count} · ${countFormat.format(matches.length)} species`;
        previousSpecies.disabled = speciesPage === 0;
        nextSpecies.disabled = speciesPage === count - 1;
      }

      function renderSamplePage() {
        visibleSamples = matchingSamples();
        const ids = visibleSamples;
        const count = Math.max(1, Math.ceil(ids.length / PAGE_SIZE));
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
            refreshSampleResults();
          });
          sampleScope.append(clear);
        } else sampleScope.append(node("p", "collectors__note", "All field samples linked to this Directus collector, including unresolved identifications."));
        const cards = [];
        const tableRows = [];
        for (const fieldId of ids.slice(samplePage * PAGE_SIZE, (samplePage + 1) * PAGE_SIZE)) {
          const row = byId.get(fieldId);
          const taxon = resolveSpecies(row[7]);
          const sourceUrl = `${directusBase}/admin/content/Field_Data/${fieldId}`;
          const card = node("li", "collectors__sample species-card");
          const heading = node("h3");
          window.DBGIObservationSubject.inline(heading, row[9]);
          const dashboard = node("a", "collectors__sample-link", row[1]);
          dashboard.href = `#sample/${fieldId}`;
          heading.append(dashboard);
          card.append(heading);
          const identification = node("p", "species-identification");
          if (taxon) {
            identification.append("Resolved as ");
            const link = node("a");
            link.href = `#species/${taxon[0]}`;
            renderScientificTaxon(link, taxon);
            identification.append(link);
          } else identification.textContent = "Not resolved to a species in Directus Taxa";
          card.append(identification, node("p", "collectors__sample-meta",
            `Field name: ${row[3] || "Not recorded"} · ${projectLabel}: ${projectName(row[2])} · Date: ${row[6] || "Not recorded"}`));
          const source = node("a", "collectors__sample-source", "Field_Data in Directus ↗");
          source.href = sourceUrl;
          source.target = "_blank";
          source.rel = "noopener noreferrer";
          card.append(source);
          cards.push(card);

          const record = node("tr");
          const sampleCell = node("td");
          const sampleLink = node("a", null, row[1]);
          sampleLink.href = `#sample/${fieldId}`;
          sampleCell.append(sampleLink);
          const speciesCell = node("td");
          if (taxon) {
            const link = node("a");
            link.href = `#species/${taxon[0]}`;
            renderScientificTaxon(link, taxon);
            speciesCell.append(link);
          } else speciesCell.textContent = "—";
          record.append(sampleCell, window.DBGIObservationSubject.cell(row[9]), speciesCell,
            node("td", null, projectName(row[2])), node("td", null, row[6] || "—"));
          tableRows.push(record);
        }
        if (!cards.length) cards.push(node("li", "collectors__message", "No matching field samples."));
        sampleList.replaceChildren(...cards);
        sampleRows.replaceChildren(...tableRows);
        samplePosition.textContent = `Page ${samplePage + 1} of ${count} · ${countFormat.format(ids.length)} samples`;
        previousSample.disabled = samplePage === 0;
        nextSample.disabled = samplePage === count - 1;
      }

      function selectView(view) {
        if (view !== "map") hide();
        speciesPanel.hidden = view !== "species";
        mapPanel.hidden = view !== "map";
        samplesPanel.hidden = view !== "cards";
        listPanel.hidden = view !== "list";
        sampleControls.group.hidden = view === "species";
        sampleScope.hidden = view === "species";
        samplePager.hidden = view === "species" || view === "map";
        for (const [key, button] of views) button.setAttribute("aria-pressed", String(key === view));
        if (view === "cards" || view === "list") renderSamplePage();
        if (view === "map" && !activeMap) activeMap = window.DBGICollectorMap.mount({
          root: mapRoot, observations: visibleSamples.map(fieldId => {
            const row = byId.get(fieldId);
            return {row, taxon: resolveSpecies(row[7])};
          }), loadLeaflet, renderScientificTaxon, scopeLabel: "field",
        });
      }
      previousSpecies.addEventListener("click", () => { if (speciesPage > 0) { speciesPage--; renderSpeciesPage(); } });
      nextSpecies.addEventListener("click", () => {
        if (speciesPage < Math.ceil(visibleSpecies.length / SPECIES_PAGE_SIZE) - 1) { speciesPage++; renderSpeciesPage(); }
      });
      previousSample.addEventListener("click", () => { if (samplePage > 0) { samplePage--; renderSamplePage(); } });
      nextSample.addEventListener("click", () => {
        const count = Math.ceil(visibleSamples.length / PAGE_SIZE);
        if (samplePage < count - 1) { samplePage++; renderSamplePage(); }
      });
      renderSpeciesPage();
      detailRoot.replaceChildren(section);
      selectView("cards");
      return true;
    }

    return Object.freeze({leaderboard, detail, hide});
  }

  window.DBGICollectors = Object.freeze({create});
})();
