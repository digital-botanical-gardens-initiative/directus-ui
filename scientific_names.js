"use strict";

// Render names without italicizing their authorship or infraspecific rank markers.
window.DBGIScientificNames = (() => {
  const italicRanks = new Set(["genus", "subgenus", "species", "subspecies", "variety", "form"]);
  const marker = /(\s+(?:subsp\.|ssp\.|var\.|subvar\.|f\.|subf\.|forma)\s+)/i;
  const isMarker = /^\s*(?:subsp\.|ssp\.|var\.|subvar\.|f\.|subf\.|forma)\s*$/i;

  function append(parent, name, rank, authorship) {
    if (!name) {
      parent.append("Unresolved");
      return;
    }
    if (italicRanks.has(String(rank || "").toLowerCase())) {
      for (const part of name.split(marker)) {
        if (!part) continue;
        if (isMarker.test(part)) parent.append(part);
        else {
          const italic = document.createElement("i");
          italic.textContent = part;
          parent.append(italic);
        }
      }
    } else parent.append(name);
    if (authorship) parent.append(` ${authorship}`);
  }

  return Object.freeze({append});
})();
