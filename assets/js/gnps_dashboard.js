"use strict";

// Profiles are Directus MS_Data snapshot rows [ms_id, field_id, instrument_id,
// status, filename, injection_method_id]. A filename is not a sample identifier or a polarity source.
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

  // GNPS2's public viewer has separate newline-separated primary and second USI
  // inputs. The first file of each group drives its map; files in a group overlay.
  function dashboardURL(primary, secondary, mz) {
    const usi = primary.map(({filename}) => `mzspec:${dataset}:${filename}`).join("\n");
    const usi2 = secondary.map(({filename}) => `mzspec:${dataset}:${filename}`).join("\n");
    const params = new URLSearchParams({usi});
    if (usi2) params.set("usi2", usi2);
    if (primary.length > 1 || secondary.length > 1) params.set("tic_overlay", "1");
    if (mz) params.set("xicmz", mz);
    params.set("tic_option", "BPI");
    return `${dashboard}?${params}#${encodeURIComponent(JSON.stringify({usi, usi2}))}`;
  }

  function element(tag, parent, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    parent.append(node);
    return node;
  }

  function render(root, {profiles, selectedIds, groupById, injectionMethods, initialMz = "", onMzChange} = {}) {
    // Unload the previous sample's frame before considering any new profiles.
    root.replaceChildren();
    root.hidden = true;
    if (!Array.isArray(profiles)) return;

    // The shared workspace passes explicit MS_Data IDs. Unlike the single-field
    // chooser, every valid selected record remains selected, even across fields.
    const shared = Array.isArray(selectedIds);
    const allowed = shared ? new Set(selectedIds.filter(validId)) : null;
    const files = new Map();
    for (const profile of profiles) {
      if (!Array.isArray(profile) || profile.length !== 6 || !["OK", "published"].includes(profile[3])) continue;
      if (shared && (!validId(profile[0]) || !validId(profile[1]) || !allowed.has(profile[0]))) continue;
      const filename = mzmlName(profile[4]);
      const key = shared ? profile[0] : filename;
      if (filename && !files.has(key)) files.set(key, {filename, id: profile[0],
        instrumentId: profile[2], profile});
    }
    if (!files.size) return;
    if (shared && groupById instanceof Map) {
      let hasPrimary = false;
      for (const id of files.keys()) if (groupById.get(id) !== "B") { hasPrimary = true; break; }
      if (!hasPrimary) return;
    }
    const entries = [...files.values()];
    const panel = element("div", root, null, "gnps-panel");
    element("h3", panel, shared ? "Selected Directus files · GNPS2 LC-MS dashboard" : "Field sample · GNPS2 LC-MS dashboard");
    element("p", panel, shared
      ? "Selected Directus MS_Data filenames are used to request GNPS2 views of MassIVE dataset MSV000102993. Their presence in this GNPS2 dataset is assumed, not verified."
      : "Directus MS_Data filenames for this field sample are used to request GNPS2 views of MassIVE dataset MSV000102993. Remote file availability is not verified.");

    let checkboxes;
    let selectedStatus;
    if (!shared && entries.length > 1) {
      const chooser = element("fieldset", panel, null, "gnps-chooser");
      element("legend", chooser, "Select MS profile files to compare");
      element("p", chooser, "Select at least one file. GNPS2 overlays selected files in the BPI chromatogram and XIC; the map and spectrum show the first selected file.", "gnps-chooser-hint");
      checkboxes = entries.map((entry, index) => {
        const label = element("label", chooser);
        const checkbox = element("input", label);
        checkbox.type = "checkbox";
        checkbox.checked = index === 0;
        label.append(entry.filename);
        window.MSProfile?.appendPolarity(label, entry.profile, injectionMethods);
        return checkbox;
      });
      selectedStatus = element("p", panel, null, "gnps-selection-status");
      selectedStatus.setAttribute("aria-live", "polite");
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
    massInput.autocomplete = "off";
    massInput.value = initialMz;
    const massButton = element("button", massForm, "Plot XIC in GNPS2");
    massButton.type = "submit";
    element("p", panel, "Use the ion m/z, not the neutral mass. Empty the input and submit to return to the BPI-only view. An XIC peak alone does not identify a compound.", "gnps-mass-hint");
    const massError = element("p", panel, "Enter a positive numeric m/z from ChemCalc.", "gnps-mass-error");
    massError.role = "status";
    massError.hidden = true;
    let selectedMz = initialMz;

    const preview = element("details", panel, null, "gnps-preview");
    element("summary", preview, "Embedded LC-MS dashboard");
    const embed = element("div", preview, null, "gnps-embed");
    element("p", preview, "On narrow screens, scroll the dashboard sideways to inspect the plot.", "gnps-scroll-hint");
    const failure = element("p", preview, "The embedded dashboard could not load. GNPS2 may be temporarily unavailable; try again later.", "gnps-failure");
    failure.hidden = true;

    let currentFrame;
    function show() {
      const selected = checkboxes ? entries.filter((_, index) => checkboxes[index].checked) : entries;
      const secondary = shared && groupById instanceof Map ? selected.filter((entry) => groupById.get(entry.id) === "B") : [];
      const primary = secondary.length ? selected.filter((entry) => groupById.get(entry.id) !== "B") : selected;
      const url = dashboardURL(primary, secondary, selectedMz);
      const describe = (entry) => `Directus MS_Data${validId(entry.id) ? ` #${entry.id}` : ""}` +
        `${validId(entry.instrumentId) ? ` · Instrument #${entry.instrumentId}` : ""} · ${entry.filename}`;
      provenance.textContent = secondary.length
        ? `Group A (${primary.length}): ${primary.map(describe).join("; ")}. Group B (${secondary.length}): ${secondary.map(describe).join("; ")}`
        : `${selected.length > 1 ? "Selected files" : "Source"}: ${selected.map(describe).join("; ")}`;
      if (selectedStatus) selectedStatus.textContent = selected.length > 1
        ? `Comparing ${selected.length} selected files: ${selected.map(({filename}) => filename).join(", ")}. Map and spectrum: ${selected[0].filename}.`
        : `Showing ${selected[0].filename} alone.`;
      link.textContent = selected.length > 1 ? "Open selected files in GNPS2 ↗" : "Open selected file in GNPS2 ↗";
      link.href = url;
      failure.hidden = true;
      if (!preview.open) return;
      if (currentFrame?.src === url && embed.contains(currentFrame)) return;
      const frame = document.createElement("iframe");
      frame.title = secondary.length
        ? `GNPS2 LC-MS dashboard comparing group A (${primary.map(({filename}) => filename).join(", ")}) with group B (${secondary.map(({filename}) => filename).join(", ")})`
        : selected.length > 1
          ? `GNPS2 LC-MS dashboard comparing ${selected.map(({filename}) => filename).join(", ")}`
          : `GNPS2 LC-MS dashboard for ${selected[0].filename}`;
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
      if (typeof onMzChange === "function") onMzChange(mz);
      preview.open = true;
      show();
    });
    if (checkboxes) {
      for (const checkbox of checkboxes) checkbox.addEventListener("change", () => {
        if (!checkboxes.some((item) => item.checked)) {
          checkbox.checked = true;
          return;
        }
        show();
      });
    }
    preview.addEventListener("toggle", () => {
      if (preview.open) {
        show();
      } else {
        embed.replaceChildren();
        currentFrame = undefined;
        failure.hidden = true;
      }
    });
    preview.open = true;
    show();
    root.hidden = false;
  }

  return Object.freeze({render, mzmlName});
})();
