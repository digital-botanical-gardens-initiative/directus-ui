"use strict";

// Snapshot columns: Taxa [id, col_id, scientific_name, authorship, rank, parent_id, backbone_version].
window.Metabolome = (() => {
  const QID = /^Q[1-9][0-9]*$/;

  function speciesAncestor(taxon, taxaById) {
    const visited = new Set();
    while (Array.isArray(taxon) && !visited.has(taxon[0])) {
      if (taxon[4] === "species") return taxon;
      visited.add(taxon[0]);
      taxon = taxon[5] == null ? null : taxaById.get(taxon[5]);
    }
    return null;
  }

  function render(root, {taxon, taxaById, mapping}) {
    // Replacing the subtree also unloads any iframe from the previous sample.
    root.replaceChildren();
    root.hidden = true;
    if (!(taxaById instanceof Map) || !Array.isArray(mapping?.rows)) return;
    const species = speciesAncestor(taxon, taxaById);
    if (!species) return;
    const colId = species[1];

    const panel = document.createElement("div");
    panel.className = "metabolome-panel";
    const heading = document.createElement("h3");
    heading.append("Species metabolome · ");
    window.DBGIScientificNames.append(heading, species[2] || colId, species[4]);
    panel.append(heading);

    const match = typeof colId === "string" && colId
      ? mapping.rows.find((row) => Array.isArray(row) && row[0] === colId)
      : null;
    const qid = match?.[1];
    if (typeof qid !== "string" || !QID.test(qid)) {
      const absence = document.createElement("p");
      absence.textContent = "No Wikidata-linked species is available for a LOTUS search in this snapshot.";
      panel.append(absence);
    } else {
      // LOTUS documents ?execute=true for running a URL-driven search on load.
      const url = `https://lotus-initiative.github.io/lotus-explore-rs/search/?taxon=${qid}&execute=true`;
      const description = document.createElement("p");
      description.textContent = "LOTUS Explorer searches externally reported chemical occurrences for this species. These literature and Wikidata annotations are not measurements of this field sample or results from Directus MS_Data.";
      panel.append(description);

      const embed = document.createElement("div");
      embed.className = "metabolome-embed";
      const frame = document.createElement("iframe");
      frame.title = `LOTUS Explorer taxon search for ${species[2] || colId}`;
      frame.loading = "lazy";
      frame.referrerPolicy = "no-referrer";
      frame.src = url;
      embed.append(frame);
      panel.append(embed);

      const fallback = document.createElement("p");
      fallback.className = "metabolome-source";
      fallback.append("This is the complete LOTUS Explorer, not a results-only view. If the embedded search is blocked or unavailable, ");
      const link = document.createElement("a");
      link.textContent = "open the species taxon search on LOTUS Explorer ↗";
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.referrerPolicy = "no-referrer";
      fallback.append(link, ". The external explorer queries public Wikidata/SPARQL services.");
      panel.append(fallback);
    }
    root.append(panel);
    root.hidden = false;
  }

  return {render};
})();
