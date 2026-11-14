"use strict";

// Snapshot columns are an explicit contract with scripts/build_inaturalist.py.
window.INaturalist = (() => {
  const FIELDS = ["sample_id", "field_id", "observation_id", "observer_taxon_id", "observer_name",
    "observer_rank", "community_taxon_id", "community_name", "community_rank", "col_id", "col_name",
    "col_rank", "status", "reason", "photos"];
  const STATUS = ["potential disagreement", "agreement", "unassessable"];
  const node = (tag, text, parent, className) => {
    const element = document.createElement(tag);
    if (text != null) element.textContent = String(text);
    if (className) element.className = className;
    if (parent) parent.append(element);
    return element;
  };
  const link = (parent, url, text, external = true) => {
    const anchor = node("a", text, parent);
    anchor.href = url;
    if (external) {
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.referrerPolicy = "no-referrer";
    }
    return anchor;
  };
  const obsUrl = (id) => `https://www.inaturalist.org/observations/${id}`;
  const taxonUrl = (id) => `https://www.inaturalist.org/taxa/${id}`;
  const curationUrl = (data, id) => `${data.source.replace(/\/items\/Curation_Data$/, "/admin/content/Curation_Data")}/${id}`;
  const nameLabel = (parent, name, rank, id) => {
    window.DBGIScientificNames.append(parent, name, rank);
    if (rank) parent.append(` (${rank})`);
    if (id != null) parent.append(` · ${id}`);
  };
  const rowsFor = (data) => {
    if (!data || FIELDS.join(",") !== data.columns?.join(",") || !Array.isArray(data.rows)) {
      throw new Error("Unexpected iNaturalist snapshot format");
    }
    return data.rows;
  };
  const counts = (rows) => Object.fromEntries(STATUS.map((status) => [status, rows.filter((row) => row[12] === status).length]));

  const sizedPhoto = (url, size) => url.replace("/square.", `/${size}.`);

  function gallery(parent, row, sampleId) {
    const photos = row[14];
    if (!photos.length) {
      const fallback = node("p", "No observation photos available. ", parent);
      link(fallback, obsUrl(row[2]), `View original observation ${row[2]} ↗`);
      return;
    }
    const figure = node("figure", null, parent, "inat-figure");
    const photoLink = link(figure, obsUrl(row[2]), "");
    photoLink.setAttribute("aria-label", `Open original iNaturalist observation ${row[2]}`);
    const image = node("img", null, photoLink);
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    const unavailable = node("p", null, figure, "inat-image-unavailable");
    const caption = node("figcaption", null, figure);
    const position = node("strong", null, caption);
    node("span", " · ", caption);
    link(caption, obsUrl(row[2]), `Original observation ${row[2]} ↗`);
    const credit = node("span", null, caption);
    credit.setAttribute("aria-live", "polite");
    const thumbs = photos.length > 1 ? node("div", null, figure, "inat-thumbnails") : null;
    const buttons = photos.map((photo, index) => {
      if (!thumbs) return null;
      const button = node("button", null, thumbs, "inat-thumb");
      button.type = "button";
      button.setAttribute("aria-label", `Show photo ${index + 1} of ${photos.length} for observation ${row[2]}`);
      const thumbnail = node("img", null, button);
      thumbnail.src = photo[0];
      thumbnail.alt = "";
      thumbnail.loading = "lazy";
      thumbnail.referrerPolicy = "no-referrer";
      return button;
    });
    let selected = 0;
    let quality = 0;
    const sizes = ["large", "medium", "square"];
    image.addEventListener("error", () => {
      if (quality < sizes.length - 1) {
        quality++;
        image.src = sizedPhoto(photos[selected][0], sizes[quality]);
      } else {
        image.removeAttribute("src");
        image.hidden = true;
        unavailable.textContent = "Photo could not be loaded. Open the original observation instead.";
      }
    });
    const select = (index) => {
      selected = index;
      quality = 0;
      const photo = photos[index];
      position.textContent = `Photo ${index + 1} of ${photos.length}`;
      credit.textContent = photo[1] || photo[2] ?
        ` · Credit: ${photo[1] || "unavailable"} · ${photo[2] || "license unavailable"}` :
        " · Photo credit unavailable";
      unavailable.textContent = "";
      image.hidden = false;
      image.alt = `Photo ${index + 1} of ${photos.length}: ${row[4] || row[7] || "unidentified plant"}`;
      image.src = sizedPhoto(photo[0], sizes[quality]);
      for (const [i, button] of buttons.entries()) if (button) button.setAttribute("aria-pressed", String(i === index));
    };
    buttons.forEach((button, index) => button?.addEventListener("click", () => select(index)));
    select(0);
  }

  function renderSample(root, sampleId, data) {
    root.replaceChildren();
    if (!data) {
      node("p", "iNaturalist observations unavailable for this snapshot.", root);
      return 0;
    }
    const observations = rowsFor(data).filter((row) => row[0] === sampleId);
    if (!observations.length) {
      node("p", "No linked iNaturalist observations for this sample.", root);
      return 0;
    }
    node("h3", "iNaturalist observations", root);
    const list = node("div", null, root, "inat-observations");
    for (const row of observations) {
      const item = node("article", null, list);
      const title = node("h4", `Observation ${row[2]} · `, item, "inat-observation-heading");
      node("span", row[12], title, `inat-status inat-${row[12].replace(/\s+/g, "-")}`);
      gallery(item, row, sampleId);
      const comparison = node("dl", null, item, "inat-compare");
      node("dt", "iNaturalist community", comparison);
      const community = node("dd", null, comparison);
      if (row[7]) nameLabel(community, row[7], row[8], row[6]);
      else community.textContent = row[6] == null ? "Not available" : `Name unavailable · ID ${row[6]}`;
      node("dt", "Resolved CoL", comparison);
      const resolved = node("dd", null, comparison);
      if (row[10]) nameLabel(resolved, row[10], row[11], row[9]);
      else resolved.textContent = "Not resolved";
      if (row[4]) {
        const recorded = node("details", null, item, "inat-recorded");
        node("summary", "Observer identification", recorded);
        nameLabel(node("p", null, recorded), row[4], row[5], row[3]);
      }
      const source = node("p", null, item, "inat-source");
      link(source, curationUrl(data, row[2]), "Directus curation record ↗");
      if (row[6] != null) {
        node("span", " · ", source);
        link(source, taxonUrl(row[6]), "Community taxon ↗");
      }
    }
    return observations.length;
  }

  function renderReview(root, data, samplesSnapshot) {
    root.replaceChildren();
    if (!data) {
      node("p", "iNaturalist review data unavailable.", root);
      return;
    }
    const rows = rowsFor(data);
    const sampleIds = new Set(samplesSnapshot?.rows?.map((row) => row[0]) || []);
    const summary = counts(rows);
    const info = node("p", `${rows.length} linked observations across ${data.linked_samples ?? 0} samples · ${summary["potential disagreement"]} potential disagreements · ${summary.agreement} agreements · ${summary.unassessable} unassessable.`, root);
    info.className = "inat-summary";
    node("p", "Directus Curation_Data provides observation IDs, sample joins, observer identifications, community taxon IDs, and all ordered photo URLs. iNaturalist API is an external lookup for community scientific name/rank and matched photo credit/license only; CoL name/rank and ID come from Directus Taxa. Names are compared only at the same comparable rank. Different names are review candidates, not proof of an error: taxonomies and synonyms may differ. Null community IDs and unmatched ranks are unassessable. Selection is local; nothing is uploaded or updated.", root);
    const controls = node("div", null, root, "inat-controls");
    const searchLabel = node("label", "Search sample, observation, or taxon ", controls);
    const search = node("input", null, searchLabel);
    search.type = "search";
    const statusLabel = node("label", "Status ", controls);
    const filter = node("select", null, statusLabel);
    for (const [value, text] of [["potential disagreement", "Potential disagreements"], ["all", "All statuses"], ["agreement", "Agreements"], ["unassessable", "Unassessable"]]) {
      const option = node("option", text, filter);
      option.value = value;
    }
    filter.value = "potential disagreement";
    const selectedCount = node("p", "0 selected for review (local only).", root);
    selectedCount.setAttribute("aria-live", "polite");
    const resultCount = node("p", null, root);
    resultCount.setAttribute("aria-live", "polite");
    const table = node("table", null, root, "inat-table");
    const head = node("thead", null, table);
    const heading = node("tr", null, head);
    for (const value of ["Select", "Sample", "iNaturalist community (external name lookup)", "CoL resolved (Directus Taxa)", "Status and reason", "Sources"]) {
      node("th", value, heading).scope = "col";
    }
    const body = node("tbody", null, table);
    const overflow = node("p", null, root, "inat-overflow");
    const selected = new Set();
    const updateSelected = () => { selectedCount.textContent = `${selected.size} selected for review (local only).`; };
    const repaint = () => {
      body.replaceChildren();
      const query = search.value.trim().toLocaleLowerCase();
      const matches = rows.filter((row) => (filter.value === "all" || row[12] === filter.value) &&
        [row[0], row[2], row[4], row[7], row[10], row[9]].some((value) => String(value ?? "").toLocaleLowerCase().includes(query)));
      resultCount.textContent = `${matches.length} of ${rows.length} observations shown.`;
      // Keep DOM responsive when a filter displays thousands of observations.
      const shown = matches.slice(0, 200);
      for (const row of shown) {
        const tr = node("tr", null, body);
        const cell = node("td", null, tr);
        const checkbox = node("input", null, cell);
        checkbox.type = "checkbox";
        checkbox.checked = selected.has(row[2]);
        checkbox.setAttribute("aria-label", `Select observation ${row[2]} for local review`);
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) selected.add(row[2]);
          else selected.delete(row[2]);
          updateSelected();
        });
        const sampleCell = node("td", null, tr);
        if (sampleIds.has(row[1])) link(sampleCell, `#sample/${row[1]}`, row[0], false);
        else node("span", row[0], sampleCell);
        nameLabel(node("td", null, tr), row[7], row[8], row[6]);
        nameLabel(node("td", null, tr), row[10], row[11], row[9]);
        node("td", `${row[12]} · ${row[13]}`, tr);
        const links = node("td", null, tr);
        link(links, obsUrl(row[2]), `iNat ${row[2]} ↗`);
        node("span", " · ", links);
        link(links, curationUrl(data, row[2]), "Directus ↗");
        if (row[6] != null) {
          node("span", " · ", links);
          link(links, taxonUrl(row[6]), "Community taxon ↗");
        }
      }
      overflow.textContent = matches.length > shown.length ?
        `Showing first ${shown.length} of ${matches.length}; refine search to inspect more.` : "";
    };
    search.addEventListener("input", repaint);
    filter.addEventListener("change", repaint);
    repaint();
  }

  return {renderSample, renderReview};
})();
