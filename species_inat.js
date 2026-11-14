"use strict";

// External taxon-reference photos are never joined to Directus observations or field samples.
window.SpeciesINat = (() => {
  const QID = /^Q[1-9][0-9]*$/;
  const INAT_ID = /^[1-9][0-9]*$/;
  const LICENSE = /^cc(?:0|-by(?:-sa|-nc(?:-sa|-nd)?|-nd)?)$/;
  const IMAGE_HOSTS = new Set([
    "inaturalist-open-data.s3.amazonaws.com", "static.inaturalist.org", "images.inaturalist.org",
  ]);
  let serial = 0;
  let observer = null;
  let controller = null;

  function node(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined) item.textContent = text;
    return item;
  }

  async function json(url, signal) {
    const response = await fetch(url, {signal, referrerPolicy: "no-referrer"});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  function photoUrl(photo) {
    if (!Number.isSafeInteger(photo?.id) || photo.id <= 0 ||
        typeof photo.license_code !== "string" || !LICENSE.test(photo.license_code) ||
        typeof photo.attribution !== "string" || !photo.attribution.trim()) return null;
    const source = photo.medium_url;
    if (typeof source !== "string") return null;
    try {
      const url = new URL(source);
      if (url.protocol !== "https:" || !IMAGE_HOSTS.has(url.hostname) || url.username || url.password ||
          url.search || url.hash ||
          !url.pathname.endsWith(`/photos/${photo.id}/medium.jpg`) &&
          !url.pathname.endsWith(`/photos/${photo.id}/medium.jpeg`)) return null;
      return url.href;
    } catch { return null; }
  }

  function render(root, {taxon, mapping}) {
    ++serial;
    const current = serial;
    observer?.disconnect();
    controller?.abort();
    observer = null;
    controller = null;
    root.replaceChildren();
    root.hidden = true;
    if (taxon?.[4] !== "species" || !Array.isArray(mapping?.rows)) return;
    const match = mapping.rows.find((row) => Array.isArray(row) && row[0] === taxon[1]);
    const qid = match?.[1];
    if (!QID.test(qid || "")) return;

    const heading = node("h3", null, "Species photos · iNaturalist");
    const note = node("p", "species-inat__note", "iNaturalist taxon reference photos, not photos of these Directus field samples or linked observations. Only CC-licensed photos are shown.");
    const status = node("p", "species-inat__status", "Loading taxon reference photos…");
    status.setAttribute("role", "status");
    root.append(heading, note, status);
    root.hidden = false;

    async function load() {
      controller = new AbortController();
      const {signal} = controller;
      try {
        // The local CoL→Wikidata match is exact. P3151 is Wikidata's iNaturalist taxon ID.
        const wiki = await json(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims&format=json&origin=*`, signal);
        if (current !== serial) return;
        const claims = wiki?.entities?.[qid]?.claims?.P3151;
        const id = claims?.length === 1 ? String(claims[0]?.mainsnak?.datavalue?.value) : "";
        if (!INAT_ID.test(id)) {
          status.textContent = "No unique iNaturalist species taxon is linked to this Wikidata item.";
          return;
        }
        const payload = await json(`https://api.inaturalist.org/v1/taxa/${id}`, signal);
        if (current !== serial) return;
        const record = payload?.results?.[0];
        if (payload?.total_results !== 1 || record?.id !== Number(id) || record.rank !== "species" ||
            record.is_active !== true || typeof record.name !== "string" || !record.name.trim()) {
          status.textContent = "The linked iNaturalist taxon is not an active species; no photos are shown.";
          return;
        }
        const url = `https://www.inaturalist.org/taxa/${id}`;
        const source = node("p", "species-inat__source");
        source.append("Listed as ");
        const name = node("i", null, record.name);
        source.append(name, " on ");
        const taxonLink = node("a", null, "iNaturalist ↗");
        taxonLink.href = url;
        taxonLink.target = "_blank";
        taxonLink.rel = "noopener noreferrer";
        taxonLink.referrerPolicy = "no-referrer";
        source.append(taxonLink, ". Names and classification can differ between iNaturalist and Directus CoL.");
        const gallery = node("div", "species-inat__gallery");
        const seen = new Set();
        for (const entry of Array.isArray(record.taxon_photos) ? record.taxon_photos : []) {
          const photo = entry?.photo;
          const imageUrl = photoUrl(photo);
          if (!imageUrl || seen.has(photo.id)) continue;
          seen.add(photo.id);
          const figure = node("figure", "species-inat__photo");
          const link = node("a");
          link.href = `https://www.inaturalist.org/photos/${photo.id}`;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.referrerPolicy = "no-referrer";
          const image = node("img");
          image.src = imageUrl;
          image.alt = `${record.name} · iNaturalist taxon reference photo (not a DBGI specimen)`;
          image.loading = "lazy";
          image.decoding = "async";
          image.referrerPolicy = "no-referrer";
          link.append(image);
          const credit = node("figcaption", null, `${photo.attribution} · Photo ↗`);
          figure.append(link, credit);
          gallery.append(figure);
        }
        status.replaceChildren(source);
        if (gallery.children.length) root.append(gallery);
        else root.append(node("p", "species-inat__note", "No CC-licensed taxon reference photos are available for this species."));
      } catch (error) {
        if (current === serial && error.name !== "AbortError") {
          status.textContent = "iNaturalist species photos are temporarily unavailable.";
        }
      }
    }
    if (typeof IntersectionObserver === "undefined") return load();
    observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      observer = null;
      void load();
    }, {rootMargin: "240px"});
    observer.observe(root);
  }

  return {render};
})();
