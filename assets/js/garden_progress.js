/* Static, read-only garden progress chart. Integration: window.GardenProgress.render(root, data). */
(function () {
  "use strict";

  const STAGES = [
    ["ms_record_present", "Profiled"],
    ["extraction_record_present", "Extracted"],
    ["collected_only", "Collected"],
  ];
  const format = new Intl.NumberFormat("en");
  const percent = (value, total) => `${(100 * value / total).toFixed(1)}%`;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function validate(data) {
    if (!data || !Array.isArray(data.gardens) || !data.gardens.length ||
        !Number.isFinite(Date.parse(data.generated_at)) || typeof data.method !== "string" ||
        !Number.isSafeInteger(data.total_samples) || data.total_samples <= 0 ||
        !Number.isSafeInteger(data.ms_without_extraction_samples) || data.ms_without_extraction_samples < 0) {
      throw new Error("Invalid garden progress snapshot");
    }
    const names = new Set();
    let total = 0;
    for (const garden of data.gardens) {
      if (!garden || typeof garden.garden !== "string" || !garden.garden.trim() ||
          names.has(garden.garden) || !Number.isSafeInteger(garden.samples) || garden.samples <= 0 ||
          !STAGES.every(([field]) => Number.isSafeInteger(garden[field]) && garden[field] >= 0) ||
          STAGES.reduce((sum, [field]) => sum + garden[field], 0) !== garden.samples) {
        throw new Error("Inconsistent garden progress snapshot");
      }
      names.add(garden.garden);
      total += garden.samples;
    }
    if (total !== data.total_samples ||
        data.ms_without_extraction_samples > data.gardens.reduce((sum, garden) => sum + garden.ms_record_present, 0)) {
      throw new Error("Incomplete garden progress snapshot");
    }
  }

  /** Render a validated static snapshot into a DOM element (no network or credentials). */
  function render(root, data) {
    if (!(root instanceof Element)) throw new TypeError("Garden progress root must be an element");
    validate(data);
    const maximum = Math.max(...data.gardens.map(garden => garden.samples));
    const section = element("section", "garden-progress");
    section.append(element("p", "garden-progress__intro",
      "Collected includes all field samples; Extracted includes samples with an extraction record or MS record; Profiled includes samples with an MS record. These totals are cumulative, while each sample occupies one bar segment: profiled on the left, then extraction-only, then collection-only. Directus records indicate processing, not verified success. Bar lengths are relative to the largest garden."));
    if (data.ms_without_extraction_samples) {
      section.append(element("p", "garden-progress__intro",
        `${format.format(data.ms_without_extraction_samples)} profiled samples lack a linked extraction record; their extraction stage is inferred from profiling, not documented by Extraction_Data.`));
    }

    const legend = element("ul", "garden-progress__legend");
    for (const [field, label] of STAGES) {
      const item = element("li", `garden-progress__${field}`);
      const swatch = element("span", "garden-progress__swatch");
      swatch.setAttribute("aria-hidden", "true");
      item.append(swatch, document.createTextNode(label));
      legend.append(item);
    }
    section.append(legend);

    const scroller = element("div", "garden-progress__scroll");
    const table = element("table", "garden-progress__table");
    const caption = element("caption", null, "Field samples by garden and Directus processing records");
    const header = element("tr");
    for (const title of [data.site === "dbgi" ? "Garden" : "Garden / project", "Progress", "Collected", "Extracted", "Profiled"]) {
      const cell = element("th", null, title);
      cell.scope = "col";
      header.append(cell);
    }
    const thead = element("thead");
    thead.append(header);
    const tbody = element("tbody");
    for (const garden of data.gardens) {
      const extracted = garden.extraction_record_present + garden.ms_record_present;
      const row = element("tr");
      const name = element("th", null, garden.garden);
      name.scope = "row";
      row.append(name);
      const barCell = element("td");
      const bar = element("div", "garden-progress__bar");
      bar.style.width = `${100 * garden.samples / maximum}%`;
      bar.setAttribute("role", "img");
      bar.setAttribute("aria-label", `${garden.garden}: Collected ${format.format(garden.samples)} (100.0%); ` +
        `Extracted ${format.format(extracted)} (${percent(extracted, garden.samples)}); ` +
        `Profiled ${format.format(garden.ms_record_present)} (${percent(garden.ms_record_present, garden.samples)}). ` +
        "Bar segments from left: profiled, extracted without MS, collected without extraction or MS.");
      for (const [field] of STAGES) {
        const segment = element("span", `garden-progress__segment garden-progress__${field}`);
        segment.style.width = `${100 * garden[field] / garden.samples}%`;
        bar.append(segment);
      }
      barCell.append(bar);
      row.append(barCell);
      for (const count of [garden.samples, extracted, garden.ms_record_present]) {
        row.append(element("td", "garden-progress__number", `${format.format(count)} (${percent(count, garden.samples)})`));
      }
      tbody.append(row);
    }
    table.append(caption, thead, tbody);
    scroller.append(table);
    section.append(scroller);
    const provenance = element("p", "garden-progress__source",
      `Directus processing records · ${format.format(data.total_samples)} field samples · Exported ${new Date(data.generated_at).toLocaleDateString("en-GB", {day: "numeric", month: "short", year: "numeric"})}.`);
    section.append(provenance);
    const notes = element("details", "garden-progress__method");
    notes.append(element("summary", null, "How the stages are counted"));
    notes.append(element("p", null, data.method));
    notes.append(element("p", null, data.site === "dbgi" ?
      "Only processing records linked to samples in these five gardens are included. This garden-only snapshot does not report counts of unlinked processing records or global record statuses." :
      "Unlinked processing records are excluded; their counts and all record statuses are recorded in the downloadable snapshot."));
    const source = element("a", null, "Directus Field_Data ↗");
    source.href = data.source + "Field_Data";
    source.target = "_blank";
    source.rel = "noopener noreferrer";
    notes.append(source);
    section.append(notes);
    root.replaceChildren(section);
  }

  window.GardenProgress = Object.freeze({ render });
})();
