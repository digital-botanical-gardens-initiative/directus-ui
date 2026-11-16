"use strict";

// A full-refresh timestamp exists only when the workflow has finished all six exports.
window.DBGIRefreshStatus = (() => {
  const exports = ["samples", "collectors", "garden_progress", "ms_profile", "processing", "inaturalist"];
  const formatter = new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    hour12: false, timeZone: "Europe/Zurich",
  });

  function timestamp(value) {
    if (typeof value !== "string" || !/(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(value)) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function complete(snapshot, manifest) {
    if (!manifest || manifest.sample_generated_at !== snapshot.generated_at ||
        manifest.snapshots?.samples !== snapshot.generated_at ||
        Object.keys(manifest.snapshots).length !== exports.length) return null;
    const finished = timestamp(manifest.completed_at);
    const samples = timestamp(snapshot.generated_at);
    if (!finished || !samples || finished < samples) return null;
    for (const name of exports) {
      const exported = timestamp(manifest.snapshots[name]);
      if (!exported || exported < samples || exported > finished) return null;
    }
    return finished;
  }

  function appendTime(parent, date) {
    const time = document.createElement("time");
    time.dateTime = date.toISOString();
    time.textContent = `${formatter.format(date)} (Europe/Zurich)`;
    parent.append(time);
  }

  function render(root, snapshot, manifest) {
    root.replaceChildren();
    const samples = timestamp(snapshot?.generated_at);
    root.hidden = !samples;
    if (!samples) return;
    const full = complete(snapshot, manifest);
    const label = document.createElement("p");
    label.className = "refresh-status__latest";
    const title = document.createElement("strong");
    title.textContent = full ? "Last successful Directus refresh: " : "Field samples last fetched: ";
    label.append(title);
    appendTime(label, full || samples);
    root.append(label);
    const detail = document.createElement("p");
    detail.className = "refresh-status__schedule";
    if (full) {
      detail.append("Field samples fetched ");
      appendTime(detail, samples);
      detail.append(" · ");
    } else {
      detail.append("No completed six-export refresh is recorded · ");
    }
    detail.append("Scheduled daily at 08:30 (Europe/Zurich, CET/CEST); GitHub may start later. ");
    const runs = document.createElement("a");
    runs.href = "https://github.com/digital-botanical-gardens-initiative/directus-ui/actions/workflows/pages.yml";
    runs.textContent = "Refresh runs ↗";
    runs.target = "_blank";
    runs.rel = "noopener noreferrer";
    detail.append(runs);
    root.append(detail);
  }

  async function load(root, snapshot) {
    render(root, snapshot, null);
    try {
      const response = await fetch("data/refresh.json", {cache: "no-cache"});
      if (response.ok) render(root, snapshot, await response.json());
    } catch { /* The sample timestamp remains accurate when the optional marker is unavailable. */ }
  }

  return {render, load};
})();
