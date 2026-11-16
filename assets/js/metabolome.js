"use strict";

// Snapshot columns: Taxa [id, col_id, scientific_name, authorship, rank, parent_id, backbone_version].
window.Metabolome = (() => {
  const QID = /^Q[1-9][0-9]*$/;
  const LOTUS_SEARCH = "https://lotus-initiative.github.io/lotus-explore-rs/search/";

  function ancestor(taxon, rank, taxaById) {
    const visited = new Set();
    while (Array.isArray(taxon) && !visited.has(taxon[0])) {
      if (taxon[4] === rank) return taxon;
      visited.add(taxon[0]);
      const parentId = taxon[5];
      if (parentId == null) break;
      const parent = taxaById.get(parentId);
      taxon = Array.isArray(parent) && parent[0] === parentId ? parent : null;
    }
    return null;
  }
  function speciesAncestor(taxon, taxaById) {
    return taxaById instanceof Map ? ancestor(taxon, "species", taxaById) : null;
  }


  function render(root, {taxon, taxaById, mapping, manual = false, comparison = false}) {
    // Replacing the subtree also unloads any iframe from the previous sample.
    root.replaceChildren();
    root.hidden = true;
    if (!(taxaById instanceof Map)) return;
    const species = speciesAncestor(taxon, taxaById);
    if (!species && !manual) return;
    const colId = species?.[1];

    const panel = document.createElement("div");
    panel.className = "metabolome-panel";
    const heading = document.createElement("h3");
    if (species) {
      heading.append("Species metabolome · ");
      window.DBGIScientificNames.append(heading, species[2] || colId, species[4]);
    } else heading.textContent = "Search LOTUS Explorer";
    panel.append(heading);

    const match = typeof colId === "string" && colId && Array.isArray(mapping?.rows)
      ? mapping.rows.find((row) => Array.isArray(row) && row[0] === colId)
      : null;
    const qid = match?.[1];
    const hasSpeciesQid = typeof qid === "string" && QID.test(qid);
    const genus = hasSpeciesQid || !species ? null : ancestor(species, "genus", taxaById);
    const genusName = typeof genus?.[2] === "string" ? genus[2].trim() : "";
    // LOTUS accepts taxon names as well as QIDs in its public URL. Only a QID
    // backed by the exact species CoL ID may be described as a species search.
    const url = hasSpeciesQid
      ? `${LOTUS_SEARCH}?taxon=${qid}&execute=true`
      : genusName
        ? `${LOTUS_SEARCH}?taxon=${encodeURIComponent(genusName)}&execute=true`
        : LOTUS_SEARCH;

    const evidenceSubject = comparison ? "the selected MS files" : "this field sample";
    const description = document.createElement("p");
    if (hasSpeciesQid) {
      description.textContent = `LOTUS Explorer searches externally reported chemical occurrences for this species. These literature and Wikidata annotations are not measurements of ${evidenceSubject} or results from Directus MS_Data.`;
    } else if (genusName) {
      description.className = "metabolome-guidance";
      description.append("No exact Wikidata species match is available in this snapshot. Searching LOTUS Explorer for the Directus genus ");
      window.DBGIScientificNames.append(description, genusName, "genus");
      description.append(` instead; LOTUS resolves that name independently. Genus-level results can include other species and do not establish occurrences for this species or measurements of ${evidenceSubject}.`);
    } else {
      description.className = "metabolome-guidance";
      description.textContent = species
        ? `No exact Wikidata species match or resolved Directus genus is available in this snapshot. Enter a genus name in LOTUS Explorer to search more broadly; results do not establish occurrences for this species or measurements of ${evidenceSubject}.`
        : "Search LOTUS Explorer by taxon or metabolite. This unscoped literature search is not evidence that any selected Directus MS file contains a compound.";
    }
    panel.append(description);

    const embed = document.createElement("div");
    embed.className = "metabolome-embed";
    const frame = document.createElement("iframe");
    frame.title = hasSpeciesQid
      ? `LOTUS Explorer taxon search for ${species[2] || colId}`
      : genusName ? `LOTUS Explorer genus search for ${genusName}` : "LOTUS Explorer search form";
    frame.loading = "lazy";
    frame.referrerPolicy = "no-referrer";
    frame.src = url;
    embed.append(frame);
    panel.append(embed);

    const fallback = document.createElement("p");
    fallback.className = "metabolome-source";
    fallback.append("This is the complete LOTUS Explorer, not a results-only view. If the embedded search is blocked or unavailable, ");
    const link = document.createElement("a");
    link.textContent = hasSpeciesQid ? "open the species taxon search on LOTUS Explorer ↗"
      : genusName ? "open the genus search on LOTUS Explorer ↗"
        : "open the LOTUS Explorer search form ↗";
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.referrerPolicy = "no-referrer";
    fallback.append(link, ". The external explorer queries public Wikidata/SPARQL services.");
    panel.append(fallback);
    root.append(panel);
    root.hidden = false;
  }

  return {render, speciesAncestor};
})();
