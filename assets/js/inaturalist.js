"use strict";

// Snapshot columns are an explicit contract with scripts/build_inaturalist.py.
window.INaturalist = (() => {
  const FIELDS = ["sample_id", "field_id", "observation_id", "observer_taxon_id", "observer_name",
    "observer_rank", "community_taxon_id", "community_name", "community_rank", "col_id", "col_name",
    "col_rank", "status", "reason", "photos", "comments_count", "comments_source"];
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
  const commentCount = (row) => Number.isSafeInteger(row[15]) && row[15] >= 0 &&
    ["iNaturalist API", "Directus Curation_Data"].includes(row[16]) ? row[15] : null;
  const commentLabel = (row) => commentCount(row) == null ? "Comments: unknown (no verified public count)" :
    `Comments: ${commentCount(row)} (${row[16]})`;

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
      node("p", commentLabel(row), item, "inat-comments");
      if (commentCount(row) > 0) {
        const commentSource = node("p", "Comment text is not republished here; ", item, "inat-comments");
        link(commentSource, obsUrl(row[2]), "read public comments (if still available) on the original observation ↗");
      }
      const comparison = node("dl", null, item, "inat-compare");
      node("dt", "Observer identification", comparison);
      const observer = node("dd", null, comparison);
      if (row[4]) nameLabel(observer, row[4], row[5], row[3]);
      else observer.textContent = row[3] == null ? "Not available" : `Name unavailable · ID ${row[3]}`;
      node("dt", "iNaturalist community", comparison);
      const community = node("dd", null, comparison);
      if (row[7]) nameLabel(community, row[7], row[8], row[6]);
      else community.textContent = row[6] == null ? "Not available (no community taxon ID)" : `Name unavailable · ID ${row[6]}`;
      node("dt", "Resolved CoL", comparison);
      const resolved = node("dd", null, comparison);
      if (row[10]) nameLabel(resolved, row[10], row[11], row[9]);
      else resolved.textContent = "Not resolved";
      if (row[6] == null && row[12] === "unassessable") {
        node("p", "Community comparison unassessable: no iNaturalist community taxon ID is available.", item, "inat-reason");
        if (row[4] && row[10] && row[5] && row[5] === row[11] &&
            row[4].trim().toLocaleLowerCase() === row[10].trim().toLocaleLowerCase()) {
          node("p", "Observer-only observation: observer and resolved CoL names match at the same rank; this is not community agreement.", item, "inat-observer-note");
        }
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
    const knownComments = rows.filter((row) => commentCount(row) > 0).length;
    const unknownComments = rows.filter((row) => commentCount(row) == null).length;
    const info = node("p", `${rows.length} linked observations across ${data.linked_samples ?? 0} samples · ${summary["potential disagreement"]} potential disagreements · ${summary.agreement} agreements · ${summary.unassessable} unassessable · ${knownComments} with public comments · ${unknownComments} comment counts unknown.`, root);
    info.className = "inat-summary";
    node("p", "Directus Curation_Data provides observation IDs, sample joins, observer identifications, community taxon IDs, and all ordered photo URLs. Comment counts come from the public iNaturalist observation API when available, otherwise public Directus Curation_Data comments_count; a positive Directus import remains evidence even if the newer API reports zero, so counts need not represent current availability. Missing or malformed counts remain unknown, never zero. Comment text (including Directus comments) is not published here. iNaturalist API also supplies external community scientific name/rank and matched photo credit/license; CoL name/rank and ID come from Directus Taxa. Names are compared only at the same comparable rank. Different names are review candidates, not proof of an error: taxonomies and synonyms may differ. Null community IDs and unmatched ranks are unassessable. Selection is local; nothing is uploaded or updated.", root);
    const controls = node("div", null, root, "inat-controls");
    const searchLabel = node("label", "Search observation metadata ", controls);
    const search = node("input", null, searchLabel);
    search.type = "search";
    const statusLabel = node("label", "Review view ", controls);
    const filter = node("select", null, statusLabel);
    for (const [value, text] of [["potential disagreement", "Potential disagreements"], ["all", "All statuses"], ["comments", "Observations with comments (all statuses)"], ["agreement", "Agreements"], ["unassessable", "Unassessable"]]) {
      const option = node("option", text, filter);
      option.value = value;
    }
    filter.value = "potential disagreement";
    const orderLabel = node("label", "Order observations ", controls);
    const order = node("select", null, orderLabel);
    for (const [value, text] of [
      ["default", "Snapshot order"],
      ["0:asc", "Sample ID (A–Z)"], ["0:desc", "Sample ID (Z–A)"],
      ["2:asc", "Observation ID (low–high)"], ["2:desc", "Observation ID (high–low)"],
      ["7:asc", "Community name (A–Z)"], ["7:desc", "Community name (Z–A)"],
      ["10:asc", "CoL name (A–Z)"], ["10:desc", "CoL name (Z–A)"],
      ["12:asc", "Review status (A–Z)"], ["12:desc", "Review status (Z–A)"],
    ]) {
      const option = node("option", text, order);
      option.value = value;
    }
    order.value = "default";
    const selectedCount = node("p", "0 selected for review (local only).", root);
    selectedCount.setAttribute("aria-live", "polite");
    const resultCount = node("p", null, root);
    resultCount.setAttribute("aria-live", "polite");
    const table = node("table", null, root, "inat-table");
    const head = node("thead", null, table);
    const heading = node("tr", null, head);
    for (const value of ["Select", "Sample", "iNaturalist community (external name lookup)", "CoL resolved (Directus Taxa)", "Status and reason", "Public comments", "Sources"]) {
      node("th", value, heading).scope = "col";
    }
    const body = node("tbody", null, table);
    const overflow = node("div", null, root, "inat-overflow");
    const previous = node("button", "Previous page", overflow);
    previous.type = "button";
    const pageInfo = node("span", null, overflow);
    const next = node("button", "Next page", overflow);
    next.type = "button";
    let page = 0;
    const selected = new Set();
    const updateSelected = () => { selectedCount.textContent = `${selected.size} selected for review (local only).`; };
    const nameOrder = new Intl.Collator(undefined, {sensitivity: "base", numeric: true});
    const repaint = () => {
      body.replaceChildren();
      const query = search.value.trim().toLocaleLowerCase();
      const matches = rows.filter((row) =>
        (filter.value === "all" || (filter.value === "comments" ? commentCount(row) > 0 : row[12] === filter.value)) &&
        row.some((value, index) => index < 14 && String(value ?? "").toLocaleLowerCase().includes(query)));
      if (order.value !== "default") {
        const [column, direction] = order.value.split(":");
        const index = Number(column);
        matches.sort((a, b) => {
          const left = a[index];
          const right = b[index];
          if (left == null || right == null) return left == null ? (right == null ? 0 : 1) : -1;
          const comparison = index === 2 ? Number(left) - Number(right) : nameOrder.compare(String(left), String(right));
          return direction === "desc" ? -comparison : comparison;
        });
      }
      const pages = Math.max(1, Math.ceil(matches.length / 200));
      page = Math.min(page, pages - 1);
      resultCount.textContent = `${matches.length} of ${rows.length} observations shown (matching results paginated).`;
      // Bound DOM work, but retain access to every match with deterministic pages.
      const shown = matches.slice(page * 200, (page + 1) * 200);
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
        node("td", commentLabel(row), tr, commentCount(row) > 0 ? "inat-comment-positive" : "");
        const links = node("td", null, tr);
        link(links, obsUrl(row[2]), `iNat ${row[2]} ↗`);
        node("span", " · ", links);
        link(links, curationUrl(data, row[2]), "Directus ↗");
        if (row[6] != null) {
          node("span", " · ", links);
          link(links, taxonUrl(row[6]), "Community taxon ↗");
        }
      }
      pageInfo.textContent = `Page ${page + 1} of ${pages} · showing ${shown.length} of ${matches.length} matches.`;
      previous.disabled = page === 0;
      next.disabled = page >= pages - 1;
    };
    search.addEventListener("input", () => { page = 0; repaint(); });
    filter.addEventListener("change", () => { page = 0; repaint(); });
    order.addEventListener("change", () => { page = 0; repaint(); });
    previous.addEventListener("click", () => { if (page > 0) { page--; repaint(); } });
    next.addEventListener("click", () => { page++; repaint(); });
    repaint();
  }

  return {renderSample, renderReview};
})();
