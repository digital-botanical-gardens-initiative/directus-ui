/* Five garden badges; integration: window.GardenBadges.render(root, catalog, rows, onSelect). */
(function () {
  "use strict";

  const format = new Intl.NumberFormat("en");
  const logo = Object.freeze({
    fribourg: "assets/garden-fribourg.webp",
    neuchatel: "assets/garden-neuchatel.webp",
    champex: "assets/garden-champex.webp",
    prague: "assets/garden-prague.webp",
    kew: "assets/garden-kew.webp",
  });

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /**
   * catalog: { gardens: [{ id, name, aliases, url }] } (data/gardens.json).
   * rows: one { id, samples } per garden, aggregated from Directus Field_Data only.
   * onSelect(gardenId) selects the garden within the host application.
   */
  function render(root, catalog, rows, onSelect) {
    if (!(root instanceof Element)) throw new TypeError("Garden badge root must be an element");
    if (typeof onSelect !== "function") throw new TypeError("Garden badge selection callback required");
    const gardens = catalog && catalog.gardens;
    if (!Array.isArray(gardens) || gardens.length !== 5 || !Array.isArray(rows) || rows.length !== gardens.length) {
      throw new Error("Incomplete garden badge catalog or Directus counts");
    }
    const counts = new Map();
    for (const row of rows) {
      if (!row || typeof row.id !== "string" || counts.has(row.id) ||
          !Number.isSafeInteger(row.samples) || row.samples < 0) {
        throw new Error("Invalid Directus garden sample count");
      }
      counts.set(row.id, row.samples);
    }
    const ids = new Set();
    const section = element("section", "garden-badges");
    section.setAttribute("aria-label", "Explore botanical gardens");
    section.append(element("p", "garden-badges__intro", "Explore five botanical gardens. Field sample counts are from Directus."));
    const list = element("ul", "garden-badges__list");
    const buttons = [];
    for (const garden of gardens) {
      if (!garden || typeof garden.id !== "string" || ids.has(garden.id) ||
          typeof garden.name !== "string" || !garden.name.trim() ||
          !Array.isArray(garden.aliases) || !garden.aliases.length ||
          typeof garden.url !== "string" ||
          !/^https:\/\/www\.dbgi\.org\/gardens\/[a-z0-9-]+\/$/.test(garden.url) ||
          !Object.hasOwn(logo, garden.id) || !counts.has(garden.id)) {
        throw new Error("Invalid garden badge catalog");
      }
      ids.add(garden.id);
      const card = element("li", "garden-badges__card");
      const button = element("button", "garden-badges__select");
      button.type = "button";
      button.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-label", `Explore ${garden.name} on the map`);
      const image = element("img", "garden-badges__logo");
      image.src = logo[garden.id];
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      button.append(image, element("span", "garden-badges__title", garden.name),
        element("span", "garden-badges__count", `${format.format(counts.get(garden.id))} field samples`));
      buttons.push(button);
      button.addEventListener("click", () => {
        for (const item of buttons) item.setAttribute("aria-pressed", String(item === button));
        onSelect(garden.id);
      });
      card.append(button);
      const link = element("a", "garden-badges__link", "Garden on DBGI ↗");
      link.href = garden.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.setAttribute("aria-label", `${garden.name} on DBGI (opens in a new tab)`);
      card.append(link);
      list.append(card);
    }
    section.append(list);
    root.replaceChildren(section);
  }

  window.GardenBadges = Object.freeze({ render });
})();
