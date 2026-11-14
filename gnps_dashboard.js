"use strict";

// Profiles are the current Field_Data sample's Directus MS_Data snapshot rows:
// [ms_id, field_id, instrument_id, status, filename]. A filename is not a sample identifier.
window.GNPSDashboard = (() => {
  const dataset = "MSV000102993";
  const dashboard = "https://dashboard2.gnps2.org/";
  const safeName = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
  const validId = (id) => Number.isSafeInteger(id) && id > 0;

  function mzmlName(filename) {
    if (typeof filename !== "string" || !safeName.test(filename) || filename.includes("..")) return null;
    if (/\.mzML$/i.test(filename)) return filename;
    // A different extension cannot be turned into an mzML file by appending one.
    if (filename.includes(".")) return null;
    return `${filename}.mzML`;
  }

  function dashboardURL(filename, mz) {
    const usi = `mzspec:${dataset}:${filename}`;
    const params = new URLSearchParams({usi});
    if (mz) params.set("xicmz", mz);
    params.set("tic_option", "BPI");
    return `${dashboard}?${params}#${encodeURIComponent(JSON.stringify({usi, usi2: ""}))}`;
  }

  function element(tag, parent, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    parent.append(node);
    return node;
  }

  function render(root, {profiles} = {}) {
    // Unload the previous sample's frame before considering any new profiles.
    root.replaceChildren();
    root.hidden = true;
    if (!Array.isArray(profiles)) return;

    const files = new Map();
    for (const profile of profiles) {
      if (!Array.isArray(profile) || profile.length !== 5 || !["OK", "published"].includes(profile[3])) continue;
      const filename = mzmlName(profile[4]);
      if (filename && !files.has(filename)) files.set(filename, {filename, id: profile[0], instrumentId: profile[2]});
    }
    if (!files.size) return;
    const entries = [...files.values()];
    const panel = element("div", root, null, "gnps-panel");
    element("h3", panel, "Field sample · GNPS2 LC-MS dashboard");
    element("p", panel,
      "Directus MS_Data filenames for this field sample are used to request GNPS2 views of MassIVE dataset MSV000102993. Remote file availability is not verified.");

    let selector;
    if (entries.length > 1) {
      const chooser = element("div", panel, null, "gnps-chooser");
      const label = element("label", chooser, "MS profile file");
      selector = element("select", label);
      for (const entry of entries) {
        const option = element("option", selector, entry.filename);
        option.value = entry.filename;
      }
    }
    const provenance = element("p", panel, null, "gnps-provenance");
    const launch = element("p", panel, null, "gnps-source");
    const link = element("a", launch, "Open selected file in GNPS2 ↗");
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.referrerPolicy = "no-referrer";
    launch.append(" · Opens in a new tab.");
    const massForm = element("form", panel, null, "gnps-mass-form");
    const massLabel = element("label", massForm, "Adduct m/z from ChemCalc");
    const massInput = element("input", massLabel);
    massInput.type = "text";
    massInput.inputMode = "decimal";
    massInput.placeholder = "e.g. 195.08765";
    massInput.maxLength = 32;
    massInput.autocomplete = "off";
    const massButton = element("button", massForm, "Plot XIC in GNPS2");
    massButton.type = "submit";
    element("p", panel, "Use the ion m/z, not the neutral mass. Empty the input and submit to return to the BPI-only view. An XIC peak alone does not identify a compound.", "gnps-mass-hint");
    const massError = element("p", panel, "Enter a positive numeric m/z from ChemCalc.", "gnps-mass-error");
    massError.role = "status";
    massError.hidden = true;
    let selectedMz = "";

    const preview = element("details", panel, null, "gnps-preview");
    element("summary", preview, "Embedded LC-MS dashboard");
    const embed = element("div", preview, null, "gnps-embed");
    element("p", preview, "On narrow screens, scroll the dashboard sideways to inspect the plot.", "gnps-scroll-hint");
    const failure = element("p", preview, "The embedded dashboard could not load. GNPS2 may be temporarily unavailable; try again later.", "gnps-failure");
    failure.hidden = true;

    let currentFrame;
    function show(entry) {
      const url = dashboardURL(entry.filename, selectedMz);
      provenance.textContent = `Source: Directus MS_Data${validId(entry.id) ? ` #${entry.id}` : ""}` +
        `${validId(entry.instrumentId) ? ` · Instrument #${entry.instrumentId}` : ""} · ${entry.filename}`;
      link.href = url;
      failure.hidden = true;
      if (!preview.open) return;
      if (currentFrame?.src === url && embed.contains(currentFrame)) return;
      const frame = document.createElement("iframe");
      frame.title = `GNPS2 LC-MS dashboard for ${entry.filename}`;
      frame.loading = "lazy";
      frame.referrerPolicy = "no-referrer";
      frame.src = url;
      frame.addEventListener("error", () => {
        if (embed.contains(frame)) {
          embed.replaceChildren();
          currentFrame = undefined;
          failure.hidden = false;
        }
      });
      embed.replaceChildren(frame);
      currentFrame = frame;
    }
    massForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const mz = massInput.value.trim();
      const number = Number(mz);
      if (mz && (!/^\d+(?:\.\d+)?$/.test(mz) || !Number.isFinite(number) || number <= 0)) {
        massError.hidden = false;
        return;
      }
      massError.hidden = true;
      selectedMz = mz;
      preview.open = true;
      const entry = selector ? files.get(selector.value) : entries[0];
      if (entry) show(entry);
    });
    if (selector) selector.addEventListener("change", () => {
      const entry = files.get(selector.value);
      if (entry) show(entry);
    });
    preview.addEventListener("toggle", () => {
      if (preview.open) {
        const entry = selector ? files.get(selector.value) : entries[0];
        if (entry) show(entry);
      } else {
        embed.replaceChildren();
        currentFrame = undefined;
        failure.hidden = true;
      }
    });
    preview.open = true;
    show(entries[0]);
    root.hidden = false;
  }

  return Object.freeze({render});
})();
