/* EMI project overview; every count comes from the shared Field_Data sample snapshot. */
(function () {
  "use strict";

  const leadingProjects = Object.freeze([
    ["fung", "Fung"],
    ["champex_gradient", "Champex gradient"],
    ["bioblitz_vinesch", "ViNEsh BioBlitz"],
    ["macedonia", "Macedonia mission"],
    ["manaslu", "Manaslu mission"],
  ]);
  const format = new Intl.NumberFormat("en");

  function matches(project, scope, gardenByProject, gardenOnly = false) {
    if (!scope) return true;
    if (scope === "dbgi") return !gardenOnly && gardenByProject.has(project);
    if (scope.startsWith("g:")) return gardenByProject.get(project)?.id === scope.slice(2);
    return !gardenOnly && scope.startsWith("p:") && (project || "") === scope.slice(2);
  }

  function partition(rows, catalog) {
    const gardenByProject = new Map();
    for (const garden of catalog.gardens) {
      for (const alias of garden.aliases) {
        if (gardenByProject.has(alias)) throw new Error(`Duplicate botanical garden project ${alias}`);
        gardenByProject.set(alias, garden);
      }
    }
    const counts = new Map();
    let dbgi = 0;
    for (const row of rows) {
      const project = row[2] || "";
      if (gardenByProject.has(project)) dbgi++;
      else counts.set(project, (counts.get(project) || 0) + 1);
    }
    const leading = leadingProjects.map(([code, name]) => ({code, name, count: counts.get(code) || 0}));
    const leadingCodes = new Set(leadingProjects.map(([code]) => code));
    const other = [...counts].filter(([code]) => !leadingCodes.has(code))
      .map(([code, count]) => ({code, name: code || "Unassigned", count}))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    return {dbgi, leading, other};
  }

  function element(tag, className, text, parent) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    if (parent) parent.append(node);
    return node;
  }

  function sampleLink(parent, scope, onProject) {
    const link = element("a", "emi-projects__link", "Browse samples →", parent);
    link.href = "#samples";
    link.addEventListener("click", () => onProject(scope));
  }

  function projectCard(parent, {code, name, count}, onProject) {
    const card = element("li", "emi-projects__card", undefined, parent);
    element("h3", "emi-projects__name", name, card);
    element("p", "emi-projects__code", `Directus project · ${code || "Unassigned"}`, card);
    element("p", "emi-projects__count", `${format.format(count)} field samples`, card);
    sampleLink(card, `p:${code}`, onProject);
  }

  function render(root, snapshot, catalog, gardenSummaries, onGarden, onProject) {
    if (snapshot.site === "dbgi") {
      window.GardenBadges.render(root, catalog, gardenSummaries, onGarden);
      return;
    }
    const {dbgi, leading, other} = partition(snapshot.rows, catalog);
    const section = element("section", "emi-projects");
    section.setAttribute("aria-label", "Explore projects");
    const list = element("ul", "emi-projects__list", undefined, section);
    const group = element("li", "emi-projects__card emi-projects__card--dbgi", undefined, list);
    element("h3", "emi-projects__name", "DBGI", group);
    element("p", "emi-projects__code", "Five botanical gardens · Directus garden projects", group);
    element("p", "emi-projects__count", `${format.format(dbgi)} field samples`, group);
    sampleLink(group, "dbgi", onProject);
    const gardens = element("details", "emi-projects__gardens", undefined, group);
    element("summary", "emi-projects__toggle", "Explore five botanical gardens", gardens);
    const badges = element("div", "emi-projects__badges", undefined, gardens);
    window.GardenBadges.render(badges, catalog, gardenSummaries, onGarden);
    for (const project of leading) projectCard(list, project, onProject);
    if (other.length) {
      const more = element("details", "emi-projects__other", undefined, section);
      element("summary", "emi-projects__toggle", `Other Directus projects (${other.length})`, more);
      const otherList = element("ul", "emi-projects__other-list", undefined, more);
      for (const project of other) projectCard(otherList, project, onProject);
    }
    root.replaceChildren(section);
  }

  window.EMIProjects = Object.freeze({matches, partition, render});
})();
