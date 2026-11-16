"use strict";

const $ = (id) => document.getElementById(id);
const format = (n) => new Intl.NumberFormat("en").format(n);
const PAGE_SIZE = 40;
const FAMILY_PAGE_SIZE = 20;
const PRECISE_MAP_ZOOM = 19;
const TREEMAP_COLORS = [
  ["#0072B2", "#fff"], ["#E69F00", "#111"], ["#009E73", "#111"], ["#CC79A7", "#111"],
  ["#D55E00", "#111"], ["#56B4E9", "#111"], ["#332F56", "#fff"], ["#F0E442", "#111"],
];
let rows = [];
let projects = [];
let gardenCatalog;
let gardenSummaries = [];
const gardenByProject = new Map();
const gardenById = new Map();
let families = [];
let filtered = [];
let page = 0;
let selectedTaxonId = null;
const byId = new Map();
let familyPage = 0;
const taxaById = new Map();
const speciesByTaxon = new Map();
const speciesRows = new Map();
let speciesPage = 0;
let selectedSpeciesId = null;
let visibleSpeciesRows = [];
let speciesView = "cards";
let speciesMapController;
let selectedTaxonPageId = null;
let taxonPage = 0;
let taxonRows = [];
let visibleTaxonRows = [];
let taxonView = "cards";
let taxonMapController;
const familyByTaxon = new Map();
let directusBase = "";
let sampleSnapshot;
let inaturalistData;
let inaturalistError = "";
let inaturalistPromise;
let wikidataTaxa;
let wikidataPromise;
let msProfileIndex;
let msProfilePromise;
let msProfileError = "";
let processingIndex;
let processingPromise;
let processingError = "";
let sampleView = "cards";
let leafletPromise;
let samplesMap;
let markerLayer;
let mapSelection = null;
let treemapRoot;
let treemapCurrent;
let treemapSelected = null;
let selectedTreemapTaxa = null;
let collectorsView;
let collectorsPromise;
let networkController;

function element(tag, text, parent, className) {
  const node = document.createElement(tag);
  node.textContent = text ?? "";
  if (className) node.className = className;
  if (parent) parent.append(node);
  return node;
}

function projectName(value) { return value || "Unassigned"; }
function projectMatches(project, scope) {
  if (!scope) return true;
  if (scope.startsWith("g:")) return gardenByProject.get(project)?.id === scope.slice(2);
  return (project || "") === scope.slice(2);
}
function scopeName(scope) {
  return scope.startsWith("g:") ? gardenById.get(scope.slice(2))?.name || "Unknown garden" :
    projectName(scope.slice(2));
}
function resolvedName(taxon) { return taxon ? [taxon[2], taxon[3]].filter(Boolean).join(" ") : "Unresolved"; }
function scientificTaxon(parent, taxon) {
  window.DBGIScientificNames.append(parent, taxon?.[2], taxon?.[4], taxon?.[3]);
}
function catalogueLink(parent, taxon, label = "Catalogue of Life ↗") {
  const id = taxon?.[1];
  if (typeof id !== "string" || !/^[A-Za-z0-9]+$/.test(id)) return null;
  const link = element("a", label, parent);
  link.href = `https://www.catalogueoflife.org/data/taxon/${id}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("aria-label", `Open ${taxon[2]} on Catalogue of Life`);
  return link;
}
function taxonHref(taxon) {
  return `#${taxon[4] === "species" ? "species" : "taxon"}/${taxon[0]}`;
}
function lineage(id) {
  const path = [];
  const seen = new Set();
  while (id != null) {
    if (seen.has(id) || !taxaById.has(id)) throw new Error("Incomplete Taxa ancestry in snapshot");
    seen.add(id);
    const taxon = taxaById.get(id);
    path.push(taxon);
    id = taxon[5];
  }
  return path.reverse();
}
function belongsToTaxon(id, ancestorId) {
  while (id != null) {
    if (id === ancestorId) return true;
    id = taxaById.get(id)?.[5];
  }
  return false;
}

function renderTaxonClassification(root, taxon) {
  root.replaceChildren();
  const trail = element("nav", "", root, "taxon-lineage");
  trail.setAttribute("aria-label", "Directus Taxa ancestry");
  for (const ancestor of lineage(taxon[0])) {
    if (trail.childNodes.length) trail.append(" › ");
    const link = element("a", "", trail);
    scientificTaxon(link, ancestor);
    link.href = taxonHref(ancestor);
    if (ancestor[0] === taxon[0]) link.setAttribute("aria-current", "page");
  }
  element("p", "Classification follows Directus Taxa. The public CoL page is an external reference, not the source of sample grouping.", root, "muted");
  catalogueLink(root, taxon, "Open this taxon in Catalogue of Life ↗");
}
function familyOf(id) {
  if (id == null) return null;
  if (!familyByTaxon.has(id)) familyByTaxon.set(id, lineage(id).find((taxon) => taxon[4] === "family") || null);
  return familyByTaxon.get(id);
}
function speciesOf(id) {
  if (id == null) return null;
  if (!speciesByTaxon.has(id)) speciesByTaxon.set(id, lineage(id).find((taxon) => taxon[4] === "species") || null);
  return speciesByTaxon.get(id);
}

function directusItemUrl(collection, id) {
  if (!directusBase || !/^[A-Za-z][A-Za-z0-9_]*$/.test(collection) ||
      (typeof id !== "string" && !Number.isSafeInteger(id)) || String(id) === "") return "";
  return `${directusBase}/admin/content/${collection}/${encodeURIComponent(String(id))}`;
}
function itemLink(parent, collection, id, label, ariaLabel) {
  const url = directusItemUrl(collection, id);
  if (!url) return;
  const link = element("a", label, parent);
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("aria-label", ariaLabel);
}
function browseSampleScope({project = "", family = "", subject = "", map = false} = {}) {
  selectedTaxonId = null;
  selectedTreemapTaxa = null;
  $("query").value = "";
  $("project").value = project;
  $("family-query").value = family;
  $("subject-filter").value = subject ? `value:${subject.trim().toLocaleLowerCase()}` : "";
  sampleView = map ? "map" : "cards";
  filter();
}
function sampleFilterLink(parent, label, scope = {}) {
  const link = element("a", label, parent);
  link.href = "#samples";
  link.addEventListener("click", () => browseSampleScope(scope));
  return link;
}


function addMSCompareToggles(parent, row) {
  const profiles = window.MSCompare.filesForField(row[0], msProfileIndex);
  if (!profiles.length) return false;
  const controls = element("div", "", parent, "compare-ms-toggles");
  for (const profile of profiles) {
    const label = element("label", "", controls, "compare-ms-toggle");
    const input = element("input", "", label);
    input.type = "checkbox";
    input.dataset.compareId = String(profile[0]);
    input.checked = window.MSCompare.isSelected(profile[0]);
    const methodId = profile[5];
    const polarity = msProfileIndex.injectionMethods.get(methodId);
    input.title = `MS_Data #${profile[0]} · ${window.GNPSDashboard.mzmlName(profile[4])}` +
      (polarity ? ` · ${polarity} ionization (Injection_Methods #${methodId})` : "");
    label.title = input.title;
    input.setAttribute("aria-label", `Compare ${row[1]} ${input.title}`);
    label.append(`#${profile[0]}`);
    window.MSProfile.appendPolarity(label, profile, msProfileIndex.injectionMethods);
    input.addEventListener("change", () => {
      if (input.checked) window.MSCompare.selectFile(row[0], profile[0], msProfileIndex);
      else window.MSCompare.removeFile(row[0], profile[0], msProfileIndex);
      for (const checkbox of document.querySelectorAll(`[data-compare-id="${profile[0]}"]`)) checkbox.checked = input.checked;
    });
  }
  return true;
}

function show(view) {
  if (view !== "compare-ms") {
    $("compare-ms-root").replaceChildren();
    window.MSCompare.unmount();
  }
  if (view !== "collector") collectorsView?.hide();
  if (view !== "detail") {
    $("sample-map").removeAttribute("src");
    window.SampleWeather?.clear($("sample-weather"));
    $("sample-metabolome").replaceChildren();
    $("sample-metabolome").hidden = true;
    $("sample-ms").replaceChildren();
    $("sample-gnps").replaceChildren();
    $("sample-processing").replaceChildren();
    $("sample-chemcalc").replaceChildren();
    $("sample-chemcalc").hidden = true;
    $("sample-gnps").hidden = true;
  }
  if (view !== "species") {
    $("species-metabolome").replaceChildren();
    $("species-metabolome").hidden = true;
  }
  if (view !== "species") $("species-col").replaceChildren();
  if (view !== "species") {
    speciesMapController?.destroy();
    speciesMapController = null;
  }
  if (view !== "taxon") $("taxon-col").replaceChildren();
  if (view !== "taxon") {
    taxonMapController?.destroy();
    taxonMapController = null;
  }
  document.querySelector(".hero").hidden = view !== "home";
  for (const section of document.querySelectorAll(".view")) section.hidden = section.id !== `${view}-view`;
  for (const link of document.querySelectorAll("nav a")) {
    if (link.getAttribute("href") === `#${view}` || (view === "collector" && link.getAttribute("href") === "#collectors")) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  document.title = `${view === "home" ? "Sample explorer" : view[0].toUpperCase() + view.slice(1)} · DBGI`;
  if (view === "samples" && (msProfileIndex || processingIndex || msProfileError || processingError)) renderPage();
  if (view === "samples") void setSampleView(sampleView);
  if (view === "treemap" && treemapRoot) renderTreemap();
  if (view === "inaturalist") renderInaturalistReview();
  if ((view === "detail" || view === "inaturalist") && !inaturalistPromise) {
    inaturalistPromise = loadInaturalist();
  }
  if (["detail", "species", "compare-ms"].includes(view) && !wikidataPromise) wikidataPromise = loadWikidataTaxa();
  if (["detail", "species", "taxon", "samples", "compare-ms"].includes(view) && !msProfilePromise) msProfilePromise = loadMSProfiles();
  if (["detail", "species", "taxon", "samples"].includes(view) && !processingPromise) processingPromise = loadProcessing();
}

async function showCollectors(hash) {
  const detail = hash.startsWith("collector/");
  const root = $(detail ? "collector-detail" : "collectors-board");
  root.replaceChildren();
  element("p", "Loading Directus collectors…", root, "muted");
  const id = detail ? Number(hash.slice(10)) : null;
  if (detail && (!Number.isSafeInteger(id) || id <= 0)) {
    root.replaceChildren();
    element("p", "Collector not found in this snapshot.", root, "muted");
    return;
  }
  try {
    if (!collectorsPromise) collectorsPromise = (async () => {
      const response = await fetch("data/collectors.json", {cache: "no-cache"});
      if (!response.ok) throw new Error(`Snapshot request returned HTTP ${response.status}`);
      const snapshot = await response.json();
      if (snapshot.source !== directusBase || snapshot.sample_snapshot_generated_at !== sampleSnapshot.generated_at) {
        throw new Error("Collector snapshot does not match the published field-sample snapshot");
      }
      collectorsView = window.DBGICollectors.create({
        leaderboardRoot: $("collectors-board"),
        detailRoot: $("collector-detail"),
        snapshot, byId, directusBase, resolveSpecies: speciesOf,
        renderScientificTaxon: scientificTaxon, loadLeaflet,
      });
    })();
    await collectorsPromise;
    if (location.hash.slice(1) !== hash) return;
    if (detail) {
      if (!collectorsView.detail(id)) {
        root.replaceChildren();
        element("p", "Collector not found in this snapshot.", root, "muted");
      }
    } else collectorsView.leaderboard();
  } catch (error) {
    if (location.hash.slice(1) !== hash) return;
    root.replaceChildren();
    element("p", `Collectors unavailable: ${error.message}`, root, "muted");
  }
}

function route() {
  const hash = location.hash.slice(1);
  if (hash.startsWith("sample/")) {
    const id = Number(hash.slice(7));
    const row = Number.isSafeInteger(id) ? byId.get(id) : undefined;
    if (row) {
      $("status").textContent = "";
      detail(row);
      show("detail");
      setTimeout(() => scrollTo(0, 0), 0);
      return;
    }
    $("status").textContent = "Sample not found in this snapshot.";
    show("samples");
    setTimeout(() => scrollTo(0, 0), 0);
    return;
  }
  if (hash.startsWith("species/")) {
    const id = Number(hash.slice(8));
    const taxon = Number.isSafeInteger(id) ? taxaById.get(id) : undefined;
    if (taxon?.[4] === "species" && speciesRows.has(id)) {
      $("status").textContent = "";
      if (selectedSpeciesId !== id) {
        speciesPage = 0;
        $("species-query").value = "";
        $("species-project").value = "";
        $("species-subject").value = "";
        $("species-sort").value = "source";
        $("species-profiled").checked = false;
        speciesView = "cards";
        speciesMapController?.destroy();
        speciesMapController = null;
      }
      selectedSpeciesId = id;
      renderSpecies(taxon);
      show("species");
      setSpeciesView(speciesView);
      setTimeout(() => scrollTo(0, 0), 0);
      return;
    }
    $("status").textContent = "Species not found in this snapshot.";
    show("samples");
    setTimeout(() => scrollTo(0, 0), 0);
    return;
  }
  if (hash.startsWith("taxon/")) {
    const id = Number(hash.slice(6));
    const taxon = Number.isSafeInteger(id) && id > 0 ? taxaById.get(id) : undefined;
    if (taxon && taxon[4] !== "species") {
      $("status").textContent = "";
      if (selectedTaxonPageId !== id) {
        taxonPage = 0;
        $("taxon-query").value = "";
        $("taxon-project").value = "";
        $("taxon-subject").value = "";
        $("taxon-rank").value = "";
        $("taxon-sort").value = "source";
        $("taxon-profiled").checked = false;
      }
      selectedTaxonPageId = id;
      renderUpperTaxon(taxon);
      show("taxon");
      setTimeout(() => scrollTo(0, 0), 0);
      return;
    }
    $("status").textContent = "Taxon not found in this Directus snapshot.";
    show("samples");
    setTimeout(() => scrollTo(0, 0), 0);
    return;
  }
  if (hash === "compare-ms") {
    $("status").textContent = "";
    show("compare-ms");
    renderMSCompare();
    setTimeout(() => scrollTo(0, 0), 0);
    return;
  }
  if (hash === "network") {
    $("status").textContent = "";
    show("network");
    try {
      if (!networkController) networkController = window.DBGISampleNetwork.mount($("network-root"),
        {rows, taxaById, gardens: gardenCatalog, directusBase, onBrowse: browseSampleScope});
      networkController.resize();
    } catch (error) {
      $("network-root").replaceChildren();
      element("p", `Sample network unavailable: ${error.message}`, $("network-root"), "muted");
    }
    setTimeout(() => scrollTo(0, 0), 0);
    return;
  }
  if (hash === "collectors" || hash.startsWith("collector/")) {
    $("status").textContent = "";
    show(hash === "collectors" ? "collectors" : "collector");
    showCollectors(hash);
    setTimeout(() => scrollTo(0, 0), 0);
    return;
  }
  $("status").textContent = "";
  show(["home", "samples", "explore", "treemap", "inaturalist"].includes(hash) ? hash : "home");
  setTimeout(() => scrollTo(0, 0), 0);
}

function summary() {
  const resolved = rows.filter((row) => row[7] != null);
  const metrics = [["Field samples", rows.length], ["Resolved to CoL", resolved.length],
                   ["Distinct CoL taxa", new Set(resolved.map((row) => row[7])).size]];
  $("metrics").replaceChildren();
  for (const [label, value] of metrics) {
    const card = element("div", "", $("metrics"), "metric");
    element("strong", format(value), card);
    element("span", label, card);
  }
  if (!gardenCatalog || !window.GardenBadges) {
    $("featured").replaceChildren();
    element("p", "Garden badges are unavailable; sample records remain accessible.", $("featured"), "muted");
    return;
  }
  window.GardenBadges.render($("featured"), gardenCatalog, gardenSummaries, (id) => {
    selectedTaxonId = null;
    selectedTreemapTaxa = null;
    $("project").value = `g:${id}`;
    $("family-query").value = "";
    $("query").value = "";
    filter();
    sampleView = "map";
    location.hash = "#samples";
  });
}

function renderCountBar(parent, count, maximum) {
  const bar = element("span", "", parent, "count-bar");
  const track = element("span", "", bar, "count-bar-track");
  track.setAttribute("aria-hidden", "true");
  const fill = element("span", "", track, "count-bar-fill");
  fill.style.width = `${maximum ? 100 * count / maximum : 0}%`;
  element("span", format(count), bar, "count-bar-value");
}

function addTableControls(table, name) {
  if (!table || table.dataset.filterable) return;
  table.dataset.filterable = "true";
  const original = [...table.tBodies[0].rows];
  const headings = [...table.tHead.rows[0].cells];
  const controls = element("div", "", null, "filters table-filters");
  const searchLabel = element("label", `Filter ${name}`, controls);
  const search = element("input", "", searchLabel);
  search.type = "search";
  search.autocomplete = "off";
  const sortLabel = element("label", `Order ${name} by`, controls);
  const order = element("select", "", sortLabel);
  element("option", "Original order", order).value = "";
  for (const [index, heading] of headings.entries()) {
    if (["Progress", "Catalogue of Life", "Directus"].includes(heading.textContent)) continue;
    const numeric = heading.classList.contains("number") ||
      ["Collected", "Extracted", "Profiled"].includes(heading.textContent);
    element("option", `${heading.textContent} ${numeric ? "low to high" : "A–Z"}`, order).value = `${index}:asc`;
    element("option", `${heading.textContent} ${numeric ? "high to low" : "Z–A"}`, order).value = `${index}:desc`;
  }
  const count = element("span", "", controls, "muted");
  count.setAttribute("role", "status");
  table.parentElement.before(controls);
  function apply() {
    const query = search.value.trim().toLocaleLowerCase();
    const matches = original.filter((row) => !query || row.textContent.toLocaleLowerCase().includes(query));
    if (order.value) {
      const [index, direction] = order.value.split(":");
      const numeric = headings[Number(index)].classList.contains("number") ||
        ["Collected", "Extracted", "Profiled"].includes(headings[Number(index)].textContent);
      matches.sort((a, b) => {
        const left = a.cells[Number(index)].textContent;
        const right = b.cells[Number(index)].textContent;
        const result = numeric ? Number(left.replace(/[^0-9.,].*$/, "").replaceAll(",", "")) -
          Number(right.replace(/[^0-9.,].*$/, "").replaceAll(",", "")) : sampleCollator.compare(left, right);
        return direction === "desc" ? -result : result;
      });
    }
    table.tBodies[0].replaceChildren(...matches);
    count.textContent = `${format(matches.length)} of ${format(original.length)} rows`;
  }
  search.addEventListener("input", apply);
  order.addEventListener("change", apply);
  apply();
}

function explore() {
  const body = $("project-rows");
  body.replaceChildren();
  for (const project of projects) {
    const tr = element("tr", "", body);
    const cell = element("td", "", tr);
    const link = element("a", projectName(project.name), cell);
    link.href = "#samples";
    link.addEventListener("click", () => {
      selectedTaxonId = null; selectedTreemapTaxa = null; $("project").value = project.key;
      $("family-query").value = ""; $("query").value = ""; filter();
    });
    for (const n of [project.count, project.taxa.size, project.located]) element("td", format(n), tr, "number");
  }
  renderFamilies();
  const counts = new Map();
  for (const row of rows) {
    if (row[7] != null) counts.set(row[7], (counts.get(row[7]) || 0) + 1);
  }
  const taxonBody = $("taxon-rows");
  taxonBody.replaceChildren();
  const topTaxa = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 20);
  const maximum = topTaxa[0]?.[1] || 0;
  for (const [id, count] of topTaxa) {
    const taxon = taxaById.get(id);
    const tr = element("tr", "", taxonBody);
    const cell = element("td", "", tr);
    const link = element("a", "", cell);
    scientificTaxon(link, taxon);
    link.href = "#samples";
    link.addEventListener("click", () => {
      selectedTaxonId = id; selectedTreemapTaxa = null; $("query").value = resolvedName(taxon);
      $("project").value = ""; $("family-query").value = ""; filter();
    });
    const browse = element("a", "Taxon page →", cell, "taxon-browse-link");
    browse.href = taxonHref(taxon);
    element("td", taxon[4], tr);
    element("td", familyOf(id)?.[2] || "—", tr);
    renderCountBar(element("td", "", tr, "number"), count, maximum);
    catalogueLink(element("td", "", tr), taxon, "Open ↗");
  }
  addTableControls($("project-rows").closest("table"), "garden and project rows");
  addTableControls($("taxon-rows").closest("table"), "most-collected taxon rows");
}

function renderFamilies() {
  const query = $("family-table-query").value.trim().toLocaleLowerCase();
  const order = $("family-table-sort").value;
  const visible = query ? families.filter((family) => taxaById.get(family.id)[2].toLocaleLowerCase().includes(query)) :
    order === "count-desc" ? families : [...families];
  if (order !== "count-desc") {
    const key = order.replace("-desc", "");
    const direction = order.endsWith("-desc") ? -1 : 1;
    visible.sort((a, b) => {
      const comparison = key === "name" ?
        sampleCollator.compare(taxaById.get(a.id)[2], taxaById.get(b.id)[2]) :
        key === "taxa" ? a.taxa.size - b.taxa.size : a.count - b.count;
      return direction * comparison || a.id - b.id;
    });
  }
  const pageCount = Math.ceil(visible.length / FAMILY_PAGE_SIZE);
  familyPage = Math.max(0, Math.min(familyPage, Math.max(0, pageCount - 1)));
  $("family-previous").disabled = familyPage === 0;
  $("family-next").disabled = familyPage >= pageCount - 1;
  $("family-page-label").textContent = visible.length ?
    `${format(familyPage * FAMILY_PAGE_SIZE + 1)}–${format(Math.min((familyPage + 1) * FAMILY_PAGE_SIZE, visible.length))} of ${format(visible.length)} families` :
    "No matching families";
  const familyBody = $("family-rows");
  familyBody.replaceChildren();
  for (const family of visible.slice(familyPage * FAMILY_PAGE_SIZE, (familyPage + 1) * FAMILY_PAGE_SIZE)) {
    const tr = element("tr", "", familyBody);
    const cell = element("td", "", tr);
    const link = element("a", taxaById.get(family.id)[2], cell);
    link.href = "#samples";
    link.addEventListener("click", () => {
      selectedTaxonId = null; selectedTreemapTaxa = null; $("project").value = ""; $("query").value = "";
      $("family-query").value = taxaById.get(family.id)[2]; filter();
    });
    const browse = element("a", "Family page →", cell, "taxon-browse-link");
    browse.href = `#taxon/${family.id}`;
    renderCountBar(element("td", "", tr, "number"), family.count, families[0].count);
    element("td", format(family.taxa.size), tr, "number");
    catalogueLink(element("td", "", tr), taxaById.get(family.id), "Open ↗");
  }
}

function treemapChild(parent, key, taxon, label) {
  let child = parent.children.get(key);
  if (!child) {
    child = {parent, taxon, label: label || taxon[2], count: 0, own: 0, children: new Map()};
    parent.children.set(key, child);
  }
  return child;
}

function buildTreemap() {
  const scope = $("treemap-project").value;
  treemapRoot = {parent: null, taxon: null, label: "All resolved samples", count: 0, own: 0, children: new Map()};
  let total = 0;
  for (const row of rows) {
    if (!projectMatches(row[2], scope)) continue;
    total++;
    if (row[7] == null) continue;
    const ancestry = lineage(row[7]);
    const family = ancestry.find((taxon) => taxon[4] === "family");
    const genus = ancestry.find((taxon) => taxon[4] === "genus");
    let parent = treemapRoot;
    const path = [parent];
    parent = family ? treemapChild(parent, family[0], family) :
      treemapChild(parent, "no-family", null, "Without a family in Taxa");
    path.push(parent);
    if (genus && genus[0] !== parent.taxon?.[0]) {
      parent = treemapChild(parent, genus[0], genus);
      path.push(parent);
    }
    if (row[7] !== parent.taxon?.[0]) {
      parent = treemapChild(parent, row[7], taxaById.get(row[7]));
      path.push(parent);
    }
    for (const node of path) node.count++;
    parent.own++;
  }
  treemapCurrent = treemapRoot;
  treemapSelected = null;
  const familiesCount = [...treemapRoot.children.values()].filter((node) => node.taxon).length;
  $("treemap-summary").textContent = `${format(treemapRoot.count)} resolved of ${format(total)} field samples · ${format(familiesCount)} families${scope ? ` · ${scopeName(scope)}` : " · all projects"}`;
  renderTreemap();
}

function treemapLayout(nodes, width, height) {
  const total = nodes.reduce((sum, node) => sum + node.count, 0);
  if (!total) return [];
  const pending = nodes.map((node) => ({node, area: node.count * width * height / total}))
    .sort((a, b) => b.area - a.area || a.node.label.localeCompare(b.node.label));
  const result = [];
  let x = 0, y = 0, w = width, h = height, strip = [];
  function worst(items, side) {
    let sum = 0, smallest = Infinity, largest = 0;
    for (const item of items) {
      sum += item.area;
      smallest = Math.min(smallest, item.area);
      largest = Math.max(largest, item.area);
    }
    return Math.max(side * side * largest / (sum * sum), sum * sum / (side * side * smallest));
  }
  function placeStrip() {
    const area = strip.reduce((n, item) => n + item.area, 0);
    if (w >= h) {
      const stripWidth = area / h;
      let top = y;
      for (const item of strip) {
        const tileHeight = item.area / stripWidth;
        result.push({node: item.node, x, y: top, width: stripWidth, height: tileHeight});
        top += tileHeight;
      }
      x += stripWidth;
      w -= stripWidth;
    } else {
      const stripHeight = area / w;
      let left = x;
      for (const item of strip) {
        const tileWidth = item.area / stripHeight;
        result.push({node: item.node, x: left, y, width: tileWidth, height: stripHeight});
        left += tileWidth;
      }
      y += stripHeight;
      h -= stripHeight;
    }
    strip = [];
  }
  for (const item of pending) {
    if (strip.length && worst([...strip, item], Math.min(w, h)) > worst(strip, Math.min(w, h))) placeStrip();
    strip.push(item);
  }
  if (strip.length) placeStrip();
  return result;
}

function treemapTaxonIds(node) {
  const ids = new Set();
  const pending = [node];
  while (pending.length) {
    const next = pending.pop();
    if (next.own && next.taxon) ids.add(next.taxon[0]);
    if (!next.ownOnly) for (const child of next.children.values()) pending.push(child);
  }
  return ids;
}

function renderTreemapDetail(node) {
  const panel = $("treemap-detail");
  panel.replaceChildren();
  const title = element("strong", "", panel);
  if (node.taxon) {
    scientificTaxon(title, node.taxon);
    title.append(` · ${node.taxon[4]}`);
  } else title.textContent = node.label;
  element("span", `${format(node.count)} resolved sample${node.count === 1 ? "" : "s"}`, panel);
  if (node.taxon) catalogueLink(panel, node.taxon, "Open in Catalogue of Life ↗");
  if (node.taxon) {
    const browse = element("a", "Browse this taxon →", panel);
    browse.href = taxonHref(node.taxon);
  }
  if (!node.count) return;
  const link = element("a", `View ${format(node.count)} samples →`, panel);
  link.href = "#samples";
  link.addEventListener("click", () => {
    selectedTaxonId = null;
    selectedTreemapTaxa = treemapTaxonIds(node);
    $("project").value = $("treemap-project").value;
    $("query").value = "";
    $("family-query").value = "";
    filter();
  });
}

function renderTreemap() {
  if (!treemapCurrent || $("treemap-view").hidden) return;
  const path = $("treemap-path");
  path.replaceChildren();
  const ancestry = [];
  for (let node = treemapCurrent; node; node = node.parent) ancestry.unshift(node);
  for (const node of ancestry) {
    const button = element("button", "", path);
    if (node === treemapRoot) button.textContent = "All families";
    else if (node.taxon && !node.ownOnly) window.DBGIScientificNames.append(button, node.taxon[2], node.taxon[4]);
    else button.textContent = node.label;
    button.type = "button";
    button.disabled = node === treemapCurrent;
    button.addEventListener("click", () => { treemapCurrent = node; treemapSelected = null; renderTreemap(); });
  }
  const canvas = $("treemap-canvas");
  canvas.replaceChildren();
  const nodes = [...treemapCurrent.children.values()];
  if (treemapCurrent.own && nodes.length) nodes.push({
    parent: treemapCurrent, taxon: treemapCurrent.taxon, label: `Identified as ${treemapCurrent.taxon[4]}`,
    count: treemapCurrent.own, own: treemapCurrent.own, children: new Map(), ownOnly: true,
  });
  if (!treemapCurrent.count) element("p", "No resolved samples in this project.", canvas);
  for (const {node, x, y, width, height} of treemapLayout(nodes, canvas.clientWidth, canvas.clientHeight)) {
    const tile = element("button", "", canvas, "treemap-tile");
    tile.type = "button";
    tile.style.left = `${x}px`;
    tile.style.top = `${y}px`;
    tile.style.width = `${width}px`;
    tile.style.height = `${height}px`;
    let family = node;
    while (family && family.taxon?.[4] !== "family") family = family.parent;
    const [background, text] = family ?
      TREEMAP_COLORS[(Math.imul(family.taxon[0], 2654435761) >>> 0) % TREEMAP_COLORS.length] : ["#44505a", "#fff"];
    tile.style.backgroundColor = background;
    tile.style.color = text;
    const label = `${node.label} · ${format(node.count)} sample${node.count === 1 ? "" : "s"}`;
    tile.title = label;
    tile.setAttribute("aria-label", label);
    if (width >= 78 && height >= 35) {
      const name = element("span", "", tile);
      if (node.taxon && !node.ownOnly) window.DBGIScientificNames.append(name, node.taxon[2], node.taxon[4]);
      else name.textContent = node.label;
    }
    if (width >= 95 && height >= 58) element("small", format(node.count), tile);
    tile.addEventListener("click", () => {
      if (node.children.size && !node.ownOnly) {
        treemapCurrent = node;
        treemapSelected = null;
        renderTreemap();
      } else {
        treemapSelected = node;
        for (const selected of canvas.querySelectorAll(".is-selected")) selected.classList.remove("is-selected");
        tile.classList.add("is-selected");
        renderTreemapDetail(node);
      }
    });
  }
  renderTreemapDetail(treemapSelected || treemapCurrent);
}

const sampleCollator = new Intl.Collator("en", {numeric: true, sensitivity: "base"});
function sampleSearchMatches(row, query) {
  if (!query) return true;
  return [row[1], row[3], resolvedName(taxaById.get(row[7])), familyOf(row[7])?.[2],
    projectName(row[2]), gardenByProject.get(row[2])?.name, row[6]]
    .some((value) => String(value || "").toLocaleLowerCase().includes(query));
}
function sortedSamples(items, order) {
  if (order === "source") return items;
  const descending = order.endsWith("-desc");
  const field = descending ? order.slice(0, -5) : order;
  const key = (row) => {
    switch (field) {
      case "sample": return row[1];
      case "taxon": return resolvedName(taxaById.get(row[7]));
      case "field": return row[3] || "";
      case "family": return familyOf(row[7])?.[2] || "";
      case "project": return projectName(row[2]);
      case "date": return row[6] || "";
      case "profiled": return msProfileIndex?.byField.has(row[0]) ? 1 : 0;
      default: return row[1];
    }
  };
  const entries = items.map((row) => ({row, value: key(row)}));
  entries.sort((a, b) => {
    if (a.value === "" || b.value === "") return (a.value === "") - (b.value === "") || a.row[0] - b.row[0];
    const comparison = typeof a.value === "number" ? a.value - b.value : sampleCollator.compare(a.value, b.value);
    return (descending ? -comparison : comparison) || a.row[0] - b.row[0];
  });
  return entries.map((entry) => entry.row);
}
function displayCollectionDate(raw) {
  return /^\d{14}$/.test(raw || "") ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : "—";
}
function filter({keepMapSelection = false} = {}) {
  if (!keepMapSelection) mapSelection = null;
  const query = $("query").value.trim().toLocaleLowerCase();
  const project = $("project").value;
  const familyQuery = $("family-query").value.trim().toLocaleLowerCase();
  const profiledOnly = $("profiled-only").checked;
  const matchingFamilies = familyQuery ? new Set(families.filter((entry) =>
    taxaById.get(entry.id)[2].toLocaleLowerCase().includes(familyQuery)).map((entry) => entry.id)) : null;
  filtered = sortedSamples(rows.filter((row) => projectMatches(row[2], project) &&
    window.DBGIObservationSubject.matches(row[9], $("subject-filter").value) &&
    (!matchingFamilies || matchingFamilies.has(familyOf(row[7])?.[0])) &&
    (!selectedTreemapTaxa || selectedTreemapTaxa.has(row[7])) &&
    (!mapSelection || mapSelection.has(row[0])) &&
    (!profiledOnly || msProfileIndex?.byField.has(row[0])) &&
    (selectedTaxonId != null ? row[7] === selectedTaxonId : sampleSearchMatches(row, query))),
  $("sample-sort").value);
  page = 0;
  renderPage();
  const located = filtered.reduce((count, row) => count + (Number.isFinite(row[4]) && Number.isFinite(row[5]) ? 1 : 0), 0);
  $("mapped-count").textContent = `${format(located)} of ${format(filtered.length)} matching samples have coordinates. Zoom into groups to see exact locations; at maximum zoom, coincident points fan out with lines back to their recorded coordinate.`;
  if (sampleView === "map" && samplesMap && !$("samples-view").hidden) {
    fitMapToResults();
    renderMapMarkers();
  }
}

function renderPage() {
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  page = Math.min(Math.max(0, page), totalPages - 1);
  $("result-count").textContent = `${format(filtered.length)} matching samples${$("profiled-only").checked ? " · MS file recorded for this sample" : ""}${selectedTaxonId != null ? " · exact CoL taxon" : ""}${selectedTreemapTaxa ? " · treemap selection" : ""}${mapSelection ? " · selected map group" : ""}`;
  $("page-label").textContent = `Page ${page + 1} of ${totalPages}`;
  $("previous").disabled = page === 0;
  $("next").disabled = page >= totalPages - 1;
  $("empty").hidden = filtered.length !== 0;
  const body = $("sample-rows");
  const cards = $("sample-cards");
  body.replaceChildren();
  cards.replaceChildren();
  for (const row of filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
    renderSampleTableRow(body, row);
    renderFieldSampleCard(cards, row);
  }
}
function renderSampleTableRow(body, row) {
  const tr = element("tr", "", body);
  const cell = element("td", "", tr);
  const link = element("a", row[1], cell);
  tr.append(window.DBGIObservationSubject.cell(row[9]));
  link.href = `#sample/${row[0]}`;
  const taxonCell = element("td", "", tr);
  const resolved = taxaById.get(row[7]);
  const taxonLink = resolved ? element("a", "", taxonCell) : taxonCell;
  scientificTaxon(taxonLink, resolved);
  if (resolved) taxonLink.href = taxonHref(resolved);
  element("td", familyOf(row[7])?.[2] || "—", tr);
  element("td", projectName(row[2]), tr);
  element("td", displayCollectionDate(row[6]), tr);
  renderSampleStages(row, element("td", "", tr));
  const compareCell = element("td", "", tr);
  if (!addMSCompareToggles(compareCell, row)) compareCell.textContent = "—";
}
function renderSampleStages(row, parent) {
  const badges = element("div", "", parent, "stage-badges");
  element("span", "Field collected", badges, "stage-badge stage-badge--field");
  if (!processingIndex) {
    element("span", processingError ? "Extraction unknown" : "Checking extraction…", badges, "stage-badge stage-badge--unknown");
  } else {
    const extracts = (processingIndex.byField.get(row[0]) || []).filter((record) => record[0] === "extract");
    const badge = element("span", extracts.length ? "Extraction recorded" : "No extraction record", badges,
      `stage-badge ${extracts.length ? "stage-badge--extract" : "stage-badge--unknown"}`);
    if (extracts.length) badge.title = `Directus Extraction_Data status: ${[...new Set(extracts.map((record) => record[6] || "not recorded"))].join(", ")}. A record does not prove successful extraction.`;
  }
  const profiled = msProfileIndex?.byField.get(row[0])?.length;
  element("span", !msProfileIndex ? (msProfileError ? "MS status unknown" : "Checking MS…") :
    profiled ? "MS file recorded" : "No MS file recorded", badges,
    `stage-badge ${profiled ? "stage-badge--ms" : "stage-badge--unknown"}`);
}

function updateSubjectOptions(select, records) {
  const selected = select.value;
  window.DBGIObservationSubject.populate(select, records);
  if ([...select.options].some((option) => option.value === selected)) select.value = selected;
}

function renderSpecies(taxon) {
  const title = $("species-title");
  title.replaceChildren();
  scientificTaxon(title, taxon);
  const specimens = speciesRows.get(taxon[0]) || [];
  updateSubjectOptions($("species-subject"), specimens);
  $("species-summary").textContent = `${format(specimens.length)} linked field ${specimens.length === 1 ? "sample" : "samples"} · Taxa #${taxon[0]} · CoL ${taxon[1]}`;
  renderTaxonClassification($("species-col"), taxon);
  renderSpeciesMS(taxon);
  applySpeciesFilters(false);
  renderSpeciesMetabolome(taxon);
  window.SpeciesINat.render($("species-inat"), {taxon, mapping: wikidataTaxa});
}

function renderUpperTaxon(taxon) {
  taxonMapController?.destroy();
  taxonMapController = null;
  taxonRows = rows.filter((row) => row[7] != null && belongsToTaxon(row[7], taxon[0]));
  updateSubjectOptions($("taxon-subject"), taxonRows);
  const title = $("taxon-title");
  title.replaceChildren();
  scientificTaxon(title, taxon);
  $("taxon-summary").textContent = `${format(taxonRows.length)} linked field ${taxonRows.length === 1 ? "sample" : "samples"} · ${taxon[4]} · Taxa #${taxon[0]} · CoL ${taxon[1]}`;
  renderTaxonClassification($("taxon-col"), taxon);
  const ranks = $("taxon-rank");
  const selectedRank = ranks.value;
  ranks.replaceChildren(element("option", "All ranks"));
  ranks.firstChild.value = "";
  for (const rank of [...new Set(taxonRows.map((row) => taxaById.get(row[7])[4]))].sort()) {
    const option = element("option", rank, ranks);
    option.value = rank;
  }
  ranks.value = selectedRank;
  applyTaxonFilters();
  setTaxonView("cards");
}

function applyTaxonFilters() {
  if (selectedTaxonPageId == null) return;
  const query = $("taxon-query").value.trim().toLocaleLowerCase();
  const project = $("taxon-project").value;
  const rank = $("taxon-rank").value;
  const profiledOnly = $("taxon-profiled").checked;
  visibleTaxonRows = sortedSamples(taxonRows.filter((row) =>
    projectMatches(row[2], project) &&
    window.DBGIObservationSubject.matches(row[9], $("taxon-subject").value) &&
    (!rank || taxaById.get(row[7])[4] === rank) &&
    (!profiledOnly || msProfileIndex?.byField.has(row[0])) &&
    sampleSearchMatches(row, query)), $("taxon-sort").value);
  taxonPage = 0;
  renderTaxonCards();
  if (taxonView === "map" && !$("taxon-view").hidden) {
    taxonMapController?.destroy();
    taxonMapController = null;
    setTaxonView("map");
  }
}

function renderTaxonCards() {
  const pages = Math.max(1, Math.ceil(visibleTaxonRows.length / PAGE_SIZE));
  taxonPage = Math.min(Math.max(0, taxonPage), pages - 1);
  $("taxon-filter-count").textContent = `${format(visibleTaxonRows.length)} of ${format(taxonRows.length)} linked field samples`;
  $("taxon-page-label").textContent = `Page ${taxonPage + 1} of ${pages}`;
  $("taxon-previous").disabled = taxonPage === 0;
  $("taxon-next").disabled = taxonPage >= pages - 1;
  $("taxon-empty").hidden = visibleTaxonRows.length > 0 || taxonView === "map";
  const cards = $("taxon-cards");
  const table = $("taxon-sample-rows");
  cards.replaceChildren();
  table.replaceChildren();
  for (const row of visibleTaxonRows.slice(taxonPage * PAGE_SIZE, (taxonPage + 1) * PAGE_SIZE)) {
    renderFieldSampleCard(cards, row);
    renderSampleTableRow(table, row);
  }
}

function setTaxonView(view) {
  taxonView = view;
  $("taxon-cards-panel").hidden = view !== "cards";
  $("taxon-list-panel").hidden = view !== "list";
  $("taxon-pager").hidden = view === "map";
  $("taxon-map-panel").hidden = view !== "map";
  $("taxon-empty").hidden = visibleTaxonRows.length > 0 || view === "map";
  $("taxon-cards-button").setAttribute("aria-pressed", String(view === "cards"));
  $("taxon-table-button").setAttribute("aria-pressed", String(view === "list"));
  $("taxon-map").setAttribute("aria-pressed", String(view === "map"));
  if (view !== "map") {
    taxonMapController?.destroy();
    taxonMapController = null;
    return;
  }
  if (taxonMapController || $("taxon-view").hidden) return;
  taxonMapController = window.DBGICollectorMap.mount({
    root: $("taxon-map-root"),
    observations: visibleTaxonRows.map((row) => ({row, taxon: taxaById.get(row[7])})),
    loadLeaflet,
    renderScientificTaxon: scientificTaxon,
    scopeLabel: taxaById.get(selectedTaxonPageId)[2],
    taxonHref,
  });
}

function renderSpeciesMS(taxon) {
  const root = $("species-ms");
  root.replaceChildren();
  if (!msProfileIndex) {
    element("span", msProfileError ? "MS profile snapshot unavailable." : "Checking linked MS profiles…", root, "muted");
    return;
  }
  const group = msProfileIndex.bySpecies.get(taxon[0]);
  if (!group) {
    element("p", "No linked MS file recorded for this species in the MS snapshot.", root, "muted");
    return;
  }
  element("strong", "MS profile recorded", root, "species-ms-badge");
  element("p", `${format(group.fieldIds.size)} profiled field ${group.fieldIds.size === 1 ? "sample" : "samples"} of this species`, root);
  const instruments = element("p", "Instruments: ", root);
  let first = true;
  for (const id of group.instrumentIds) {
    if (!first) instruments.append(" · ");
    first = false;
    const instrument = msProfileIndex.instruments.get(id);
    itemLink(instruments, "Instruments", id, `${instrument.model} (${instrument.code})`, `Open ${instrument.model} in Directus`);
  }
}

function renderFieldSampleCard(cards, row) {
  const card = element("article", "", cards, "species-card");
  const heading = element("h3", "", card);
  window.DBGIObservationSubject.inline(heading, row[9]);
  const sample = element("a", row[1], heading);
  sample.href = `#sample/${row[0]}`;
  const identifyingTaxon = taxaById.get(row[7]);
  const identification = element("p", identifyingTaxon ? "Resolved as " : "Not resolved in Directus Taxa", card, "species-identification");
  if (identifyingTaxon) {
    const taxonLink = element("a", "", identification);
    scientificTaxon(taxonLink, identifyingTaxon);
    taxonLink.href = taxonHref(identifyingTaxon);
  }
  if (row[3] && (!identifyingTaxon || row[3] !== resolvedName(identifyingTaxon))) {
    element("p", `Field name: ${row[3]}`, card, "muted");
  }
  const date = displayCollectionDate(row[6]);
  element("p", `${gardenByProject.get(row[2])?.name || projectName(row[2])}${date === "—" ? "" : ` · ${date}`}`, card, "muted");
  if (processingIndex) {
    const stages = processingIndex.byField.get(row[0]) || [];
    const counts = ["dried", "extract", "aliquot", "ms"].map((kind) => stages.filter((record) => record[0] === kind).length);
    element("p", `${counts[0]} dried · ${counts[1]} extracts · ${counts[2]} aliquots · ${counts[3]} MS records`, card, "species-stages");
  } else {
    element("p", processingError ? "Processing snapshot unavailable." : "Checking downstream records…", card, "muted");
  }
  addMSCompareToggles(card, row);
  itemLink(card, "Field_Data", row[0], `Directus Field_Data #${row[0]} ↗`, `Open field sample ${row[1]} in Directus`);
}

function applySpeciesFilters(resetPage = true) {
  if (selectedSpeciesId == null) return;
  const specimens = speciesRows.get(selectedSpeciesId) || [];
  const query = $("species-query").value.trim().toLocaleLowerCase();
  const project = $("species-project").value;
  const profiledOnly = $("species-profiled").checked;
  visibleSpeciesRows = sortedSamples(specimens.filter((row) =>
    projectMatches(row[2], project) &&
    window.DBGIObservationSubject.matches(row[9], $("species-subject").value) &&
    (!profiledOnly || msProfileIndex?.byField.has(row[0])) &&
    sampleSearchMatches(row, query)), $("species-sort").value);
  if (resetPage) speciesPage = 0;
  renderSpeciesCards();
  if (speciesView === "map" && !$("species-view").hidden) {
    speciesMapController?.destroy();
    speciesMapController = null;
    setSpeciesView("map");
  }
}

function renderSpeciesCards() {
  const totalPages = Math.max(1, Math.ceil(visibleSpeciesRows.length / PAGE_SIZE));
  speciesPage = Math.min(Math.max(0, speciesPage), totalPages - 1);
  $("species-filter-count").textContent = `${format(visibleSpeciesRows.length)} of ${format((speciesRows.get(selectedSpeciesId) || []).length)} linked field samples`;
  $("species-page-label").textContent = `Page ${speciesPage + 1} of ${totalPages}`;
  $("species-previous").disabled = speciesPage === 0;
  $("species-next").disabled = speciesPage >= totalPages - 1;
  $("species-empty").hidden = visibleSpeciesRows.length > 0 || speciesView === "map";
  const cards = $("species-cards");
  const table = $("species-sample-rows");
  cards.replaceChildren();
  table.replaceChildren();
  for (const row of visibleSpeciesRows.slice(speciesPage * PAGE_SIZE, (speciesPage + 1) * PAGE_SIZE)) {
    renderFieldSampleCard(cards, row);
    renderSampleTableRow(table, row);
  }
}

function setSpeciesView(view) {
  speciesView = view;
  $("species-cards-panel").hidden = view !== "cards";
  $("species-list-panel").hidden = view !== "list";
  $("species-map-panel").hidden = view !== "map";
  $("species-pager").hidden = view === "map";
  $("species-empty").hidden = visibleSpeciesRows.length > 0 || view === "map";
  for (const [id, mode] of [["species-cards-button", "cards"], ["species-list-button", "list"], ["species-map-button", "map"]]) {
    $(id).setAttribute("aria-pressed", String(view === mode));
  }
  if (view !== "map") {
    speciesMapController?.destroy();
    speciesMapController = null;
    return;
  }
  if (speciesMapController || $("species-view").hidden) return;
  speciesMapController = window.DBGICollectorMap.mount({
    root: $("species-map-root"),
    observations: visibleSpeciesRows.map((row) => ({row, taxon: taxaById.get(row[7])})),
    loadLeaflet,
    renderScientificTaxon: scientificTaxon,
    scopeLabel: taxaById.get(selectedSpeciesId)[2],
    taxonHref,
  });
}

function renderSpeciesMetabolome(taxon) {
  const root = $("species-metabolome");
  root.replaceChildren();
  root.hidden = true;
  if (wikidataTaxa) window.Metabolome.render(root, {taxon, taxaById, mapping: wikidataTaxa});
}


function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (!leafletPromise) leafletPromise = new Promise((resolve, reject) => {
    const style = document.createElement("link");
    style.rel = "stylesheet";
    style.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    style.integrity = "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";
    style.crossOrigin = "anonymous";
    style.onerror = () => reject(new Error("Map stylesheet could not load"));
    style.onload = () => {
      const script = document.createElement("script");
      script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      script.integrity = "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=";
      script.crossOrigin = "anonymous";
      script.onload = resolve;
      script.onerror = () => reject(new Error("Map library could not load"));
      document.head.append(script);
    };
    document.head.append(style);
  }).catch((error) => { leafletPromise = null; throw error; });
  return leafletPromise;
}

async function setSampleView(view) {
  sampleView = view;
  $("cards-panel").hidden = view !== "cards";
  $("list-panel").hidden = view !== "list";
  $("map-panel").hidden = view !== "map";
  $("sample-pager").hidden = view === "map";
  $("view-cards").setAttribute("aria-pressed", String(view === "cards"));
  $("view-list").setAttribute("aria-pressed", String(view === "list"));
  $("view-map").setAttribute("aria-pressed", String(view === "map"));
  if (view !== "map" || $("samples-view").hidden) return;
  $("map-status").textContent = "Loading map…";
  try {
    await loadLeaflet();
    if (sampleView !== "map" || $("samples-view").hidden) return;
    if (!samplesMap) {
      samplesMap = L.map("samples-map", {scrollWheelZoom: false});
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      }).addTo(samplesMap);
      markerLayer = L.layerGroup().addTo(samplesMap);
      samplesMap.on("moveend", renderMapMarkers);
    }
    samplesMap.invalidateSize();
    fitMapToResults();
  } catch (error) {
    $("map-status").textContent = `${error.message}. The list view remains available.`;
  }
}

function fitMapToResults() {
  samplesMap.closePopup();
  $("map-status").textContent = "";
  let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity;
  for (const row of filtered) {
    const longitude = row[4], latitude = row[5];
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude) ||
        Math.abs(longitude) > 180 || Math.abs(latitude) > 90) continue;
    south = Math.min(south, latitude);
    north = Math.max(north, latitude);
    west = Math.min(west, longitude);
    east = Math.max(east, longitude);
  }
  if (south === Infinity) {
    markerLayer.clearLayers();
    samplesMap.setView([20, 0], 2);
    $("map-status").textContent = "No matching samples have valid coordinates.";
    return;
  }
  samplesMap.fitBounds(L.latLngBounds([south, west], [north, east]),
    {padding: [24, 24], maxZoom: 14, animate: false});
}

function renderMapMarkers() {
  if (!samplesMap || !markerLayer || $("samples-view").hidden || sampleView !== "map") return;
  markerLayer.clearLayers();
  const bounds = samplesMap.getBounds();
  const precise = samplesMap.getZoom() >= PRECISE_MAP_ZOOM;
  const buckets = new Map();
  for (const row of filtered) {
    if (!Number.isFinite(row[4]) || !Number.isFinite(row[5]) || !bounds.contains([row[5], row[4]])) continue;
    let key;
    if (precise) key = `${row[4]},${row[5]}`;
    else {
      const point = samplesMap.latLngToContainerPoint([row[5], row[4]]);
      key = `${Math.floor(point.x / 40)}:${Math.floor(point.y / 40)}`;
    }
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {rows: [], latitude: 0, longitude: 0};
      buckets.set(key, bucket);
    }
    bucket.rows.push(row);
    if (!precise) {
      bucket.latitude += row[5];
      bucket.longitude += row[4];
    }
  }
  for (const bucket of buckets.values()) {
    const count = bucket.rows.length;
    if (precise && samplesMap.getZoom() === 19 && count > 1) {
      const origin = [bucket.rows[0][5], bucket.rows[0][4]];
      const anchor = samplesMap.latLngToLayerPoint(origin);
      for (let index = 0; index < count; index++) {
        const angle = index * 2.399963229728653;
        const radius = 12 + 9 * Math.sqrt(index);
        const display = samplesMap.layerPointToLatLng(L.point(
          anchor.x + Math.cos(angle) * radius, anchor.y + Math.sin(angle) * radius,
        ));
        L.polyline([origin, display], {color: "#3e503c", weight: 1, opacity: 0.4, interactive: false}).addTo(markerLayer);
        const row = bucket.rows[index];
        const point = L.marker(display, {
          icon: L.divIcon({className: "sample-point", iconSize: [8, 8]}),
          title: `${row[1]} · ${resolvedName(taxaById.get(row[7]))}`,
          riseOnHover: true,
        }).addTo(markerLayer);
        point.on("click", () => {
          const content = element("div", "", null);
          window.DBGIObservationSubject.inline(content, row[9]);
          element("strong", row[1], content);
          const link = element("a", "Open ", content);
          scientificTaxon(link, taxaById.get(row[7]));
          link.append(" sample →");
          link.href = `#sample/${row[0]}`;
          element("p", `${row[5]}, ${row[4]} (recorded latitude, longitude)`, content);
          element("p", "Display point separated from coincident samples; its line leads to the exact recorded location.", content);
          L.popup({maxWidth: 340}).setLatLng(point.getLatLng()).setContent(content).openOn(samplesMap);
        });
      }
      continue;
    }
    const size = count > 999 ? 52 : count > 99 ? 42 : count > 9 ? 34 : 30;
    const position = precise ? [bucket.rows[0][5], bucket.rows[0][4]] :
      [bucket.latitude / count, bucket.longitude / count];
    const marker = L.marker(position, {
      icon: precise ? L.divIcon({className: "sample-point", iconSize: samplesMap.getZoom() === 19 ? [8, 8] : [12, 12]}) :
        L.divIcon({className: "sample-cluster", html: `<span>${count}</span>`, iconSize: [size, size]}),
      title: `${format(count)} sample${count === 1 ? "" : "s"}`,
    }).addTo(markerLayer);
    marker.on("click", () => {
      if (count > 1 && !precise) {
        samplesMap.setView(marker.getLatLng(), samplesMap.getZoom() + 1);
        return;
      }
      const content = element("div", "", null);
      element("strong", `${format(count)} sample${count === 1 ? "" : "s"} ${precise ? "at this coordinate" : "nearby"}`, content);
      if (precise) element("p", `${bucket.rows[0][5]}, ${bucket.rows[0][4]} (latitude, longitude)`, content);
      for (const row of bucket.rows.slice(0, 20)) {
        const line = element("div", "", content);
        window.DBGIObservationSubject.inline(line, row[9]);
        const link = element("a", `${row[1]} · `, line);
        scientificTaxon(link, taxaById.get(row[7]));
        link.href = `#sample/${row[0]}`;
      }
      if (count > 20) element("p", `${format(count - 20)} more in this group.`, content);
      if (count > 1) {
        const button = element("button", `Show all ${format(count)} in list`, content, "secondary");
        button.type = "button";
        button.addEventListener("click", () => {
          mapSelection = new Set(bucket.rows.map((row) => row[0]));
          filter({keepMapSelection: true});
          setSampleView("list");
        });
      }
      L.popup({maxWidth: 340, maxHeight: 260}).setLatLng(marker.getLatLng()).setContent(content).openOn(samplesMap);
    });
  }
}

function detail(row) {
  const taxon = taxaById.get(row[7]);
  const family = familyOf(row[7]);
  $("detail-title").replaceChildren();
  scientificTaxon($("detail-title"), taxon);
  $("detail-id").textContent = row[1];
  window.DBGIObservationSubject.show($("sample-subject"), row[9]);
  const species = speciesOf(row[7]);
  const speciesLink = $("detail-species");
  speciesLink.replaceChildren();
  speciesLink.hidden = !species;
  if (species) {
    const link = element("a", "All field samples of ", speciesLink);
    scientificTaxon(link, species);
    link.append(" →");
    link.href = `#species/${species[0]}`;
  }
  renderMSDetail(row);
  renderGNPSDetail(row);
  renderProcessingDetail(row);
  const fields = $("detail-fields");
  fields.replaceChildren();
  for (const [label, value] of [
    ...(gardenByProject.has(row[2]) ? [["Botanical garden", gardenByProject.get(row[2]).name]] : []),
    ["Directus project", projectName(row[2])], ["Field name (unified)", row[3] || "Not recorded"],
    ["Resolved CoL name", taxon ? resolvedName(taxon) : "Not resolved"],
    ["CoL rank", taxon?.[4] || "—"], ["CoL family", family?.[2] || "—"],
    ["CoL usage ID", taxon?.[1] || "—"], ["Taxa Directus ID", taxon?.[0] ?? "—"],
    ["Resolution status", row[8] || "Not linked"],
    ["Backbone version", taxon?.[6] || "—"],
    ["Collection date", row[6] || "Not recorded"], ["Directus record ID", String(row[0])],
  ]) {
    element("dt", label, fields);
    const cell = element("dd", value, fields);
    if (label === "Botanical garden") {
      cell.replaceChildren();
      sampleFilterLink(cell, value, {project: `g:${gardenByProject.get(row[2]).id}`, map: true});
    } else if (label === "Directus project") {
      cell.replaceChildren();
      sampleFilterLink(cell, value, {project: `p:${row[2] || ""}`});
    } else if (label === "Field name (unified)" && row[3]) {
      cell.replaceChildren();
      itemLink(cell, "Field_Data", row[0], row[3], `Open recorded field name for ${row[1]} in Directus`);
    } else if (label === "Resolved CoL name" && taxon) {
      cell.replaceChildren();
      const target = element("a", "", cell);
      scientificTaxon(target, taxon);
      target.href = taxonHref(taxon);
    } else if (label === "CoL family" && family) {
      cell.replaceChildren();
      sampleFilterLink(cell, family[2], {family: family[2]});
      const browse = element("a", "Family page →", cell, "taxon-browse-link");
      browse.href = `#taxon/${family[0]}`;
      cell.append(" ");
      catalogueLink(cell, family, "CoL ↗");
    } else if (label === "CoL usage ID" && taxon) {
      cell.replaceChildren();
      catalogueLink(cell, taxon, taxon[1]);
    } else if (label === "CoL rank" && taxon) {
      cell.replaceChildren();
      catalogueLink(cell, taxon, taxon[4]);
    } else if (label === "Taxa Directus ID" && taxon) {
      cell.replaceChildren();
      itemLink(cell, "Taxa", taxon[0], String(taxon[0]), `Open ${taxon[2]} Taxa record in Directus`);
    } else if (label === "Directus record ID") {
      cell.replaceChildren();
      itemLink(cell, "Field_Data", row[0], String(row[0]), `Open ${row[1]} field record in Directus`);
    }
  }
  const ancestry = $("ancestry");
  ancestry.hidden = !taxon;
  ancestry.open = false;
  const list = $("ancestry-list");
  list.replaceChildren();
  if (taxon) for (const ancestor of lineage(taxon[0])) {
    const item = element("li", `${ancestor[4]} · `, list);
    const publicLink = catalogueLink(item, ancestor, "");
    scientificTaxon(publicLink || item, ancestor);
    if (publicLink) publicLink.append(" ↗");
    const browse = element("a", "Related samples →", item, "taxon-browse-link");
    browse.href = taxonHref(ancestor);
  }
  const located = Number.isFinite(row[4]) && Number.isFinite(row[5]);
  $("location").hidden = !located;
  $("sample-context").classList.toggle("has-map", located);
  if (located) {
    const latitude = `${Math.abs(row[5]).toFixed(5)}° ${row[5] < 0 ? "S" : "N"}`;
    const longitude = `${Math.abs(row[4]).toFixed(5)}° ${row[4] < 0 ? "W" : "E"}`;
    $("coordinates").textContent = `${latitude}, ${longitude}`;
    const map = new URL("https://www.openstreetmap.org/export/embed.html");
    map.searchParams.set("bbox", [row[4] - 0.015, row[5] - 0.01, row[4] + 0.015, row[5] + 0.01].join(","));
    map.searchParams.set("layer", "mapnik");
    map.searchParams.set("marker", `${row[5]},${row[4]}`);
    $("sample-map").src = map.href;
    $("map-link").href = `https://www.openstreetmap.org/?mlat=${row[5]}&mlon=${row[4]}#map=15/${row[5]}/${row[4]}`;
  }
  else $("sample-map").removeAttribute("src");
  window.SampleWeather.render($("sample-weather"), {
    sampleId: row[1], date: row[6], latitude: row[5], longitude: row[4],
  });
  renderInaturalistSample(row[1]);
  renderMetabolomeDetail(taxon);
}

function renderInaturalistSample(sampleId) {
  const root = $("sample-inaturalist");
  root.replaceChildren();
  root.hidden = true;
  if (inaturalistData) root.hidden = !window.INaturalist.renderSample(root, sampleId, inaturalistData);
  else if (inaturalistError) {
    root.hidden = false;
    element("p", `Linked iNaturalist observations unavailable: ${inaturalistError}`, root, "muted");
  }
  $("sample-overview").classList.toggle("has-observations", !root.hidden);
}

function renderInaturalistReview() {
  const root = $("inaturalist-review");
  if (!sampleSnapshot) return;
  if (inaturalistData) window.INaturalist.renderReview(root, inaturalistData, sampleSnapshot);
  else if (inaturalistError) {
    root.replaceChildren();
    element("p", `iNaturalist identification review unavailable: ${inaturalistError}`, root, "muted");
  }
}

async function loadInaturalist() {
  try {
    const response = await fetch("data/inaturalist.json", {cache: "no-cache"});
    if (!response.ok) throw new Error(`Snapshot request returned HTTP ${response.status}`);
    inaturalistData = await response.json();
  } catch (error) {
    inaturalistError = error.message;
  }
  if (!sampleSnapshot) return;
  if (!$("detail-view").hidden) renderInaturalistSample($("detail-id").textContent);
  if (!$("inaturalist-view").hidden) renderInaturalistReview();
}

function renderMetabolomeDetail(taxon) {
  const root = $("sample-metabolome");
  root.replaceChildren();
  root.hidden = true;
  if (wikidataTaxa) window.Metabolome.render(root, {taxon, taxaById, mapping: wikidataTaxa});
}

async function loadWikidataTaxa() {
  try {
    const response = await fetch("data/wikidata_taxa.json", {cache: "no-cache"});
    if (!response.ok) throw new Error(`Snapshot request returned HTTP ${response.status}`);
    const mapping = await response.json();
    if (mapping.property !== "P10585" || !Array.isArray(mapping.rows)) {
      throw new Error("Unexpected CoL-to-Wikidata mapping format");
    }
    wikidataTaxa = mapping;
    if (!$("detail-view").hidden && location.hash.startsWith("#sample/")) {
      const row = byId.get(Number(location.hash.slice(8)));
      if (row) renderMetabolomeDetail(taxaById.get(row[7]));
    }
    if (!$("species-view").hidden && location.hash.startsWith("#species/")) {
      const taxon = taxaById.get(Number(location.hash.slice(9)));
      if (taxon?.[4] === "species") renderSpeciesMetabolome(taxon);
      if (taxon?.[4] === "species") window.SpeciesINat.render($("species-inat"), {taxon, mapping: wikidataTaxa});
    }
    if (!$("compare-ms-view").hidden) window.MSCompare.updateMapping(wikidataTaxa);
  } catch (error) {
    console.warn("Wikidata species links unavailable:", error);
  }
}

function renderMSCompare() {
  const root = $("compare-ms-root");
  root.replaceChildren();
  if (msProfileIndex) window.MSCompare.render(root, {index: msProfileIndex, rowsById: byId, taxaById, directusBase, mapping: wikidataTaxa});
  else element("p", msProfileError ? "Directus MS profiling snapshot unavailable." :
    "Loading Directus MS profiling records…", root, "muted");
}

function renderMSDetail(row) {
  const root = $("sample-ms");
  root.replaceChildren();
  if (msProfileIndex) {
    window.MSProfile.render(root, {row, taxaById, index: msProfileIndex, directusBase});
    if (addMSCompareToggles(root, row)) {
      const compare = element("a", "Open MS comparison →", root, "compare-ms-open");
      compare.href = "#compare-ms";
    }
  } else {
    element("span", msProfileError ? "MS profiling snapshot unavailable." : "Checking MS profiles…", root, "muted");
  }
}

function renderGNPSDetail(row) {
  const profiles = msProfileIndex?.byField.get(row[0]) || [];
  const gnps = $("sample-gnps");
  window.GNPSDashboard.render(gnps, {profiles, injectionMethods: msProfileIndex?.injectionMethods});
  const calculator = $("sample-chemcalc");
  calculator.replaceChildren();
  calculator.hidden = true;
  if (!gnps.hidden) window.ChemCalc.render(calculator);
}
function renderProcessingDetail(row) {
  const root = $("sample-processing");
  if (processingIndex) {
    root.hidden = !processingIndex.byField.get(row[0])?.length;
    if (root.hidden) root.replaceChildren();
    else window.DBGIProcessing.render(root, {row, index: processingIndex, directusBase});
  } else {
    root.hidden = false;
    root.replaceChildren();
    element("h3", "Specimen processing", root);
    element("p", processingError ? "Directus processing snapshot unavailable." : "Checking linked dried samples, extracts and aliquots…", root, "muted");
  }
}

async function loadProcessing() {
  try {
    const response = await fetch("data/processing.json", {cache: "no-cache"});
    if (!response.ok) throw new Error(`Snapshot request returned HTTP ${response.status}`);
    processingIndex = window.DBGIProcessing.buildIndex(await response.json(), byId, directusBase);
  } catch (error) {
    processingError = error.message;
    console.warn("Directus specimen processing unavailable:", error);
  }
  if (!$("detail-view").hidden && location.hash.startsWith("#sample/")) {
    const row = byId.get(Number(location.hash.slice(8)));
    if (row) renderProcessingDetail(row);
  }
  if (!$("species-view").hidden && location.hash.startsWith("#species/")) renderSpeciesCards();
  if (!$("taxon-view").hidden && location.hash.startsWith("#taxon/")) renderTaxonCards();
  if (!$("samples-view").hidden) renderPage();
}



async function loadMSProfiles() {
  try {
    const response = await fetch("data/ms_profile.json", {cache: "no-cache"});
    if (!response.ok) throw new Error(`Snapshot request returned HTTP ${response.status}`);
    const snapshot = await response.json();
    if (!directusBase || snapshot.source !== `${directusBase}/items/` ||
        !Array.isArray(snapshot.instruments) || !Array.isArray(snapshot.profiles)) {
      throw new Error("Unexpected Directus MS profiling snapshot");
    }
    msProfileIndex = window.MSProfile.buildIndex(snapshot, byId, taxaById);
  } catch (error) {
    msProfileError = error.message;
    console.warn("Directus MS profiling unavailable:", error);
  }
  if (!$("detail-view").hidden && location.hash.startsWith("#sample/")) {
    const row = byId.get(Number(location.hash.slice(8)));
    if (row) {
      renderMSDetail(row);
      renderGNPSDetail(row);
    }
  }
  if (!$("species-view").hidden && location.hash.startsWith("#species/")) {
    const taxon = taxaById.get(Number(location.hash.slice(9)));
    if (taxon?.[4] === "species") renderSpeciesMS(taxon);
  }
  if (!$("compare-ms-view").hidden) renderMSCompare();
  if (!msProfileIndex) $("profiled-only").checked = false;
  $("profiled-only").disabled = !msProfileIndex;
  if (!msProfileIndex) $("taxon-profiled").checked = false;
  $("taxon-profiled").disabled = !msProfileIndex;
  if (!msProfileIndex) $("species-profiled").checked = false;
  $("species-profiled").disabled = !msProfileIndex;
  if (!$("species-view").hidden) {
    if ($("species-profiled").checked || $("species-sort").value === "profiled-desc") applySpeciesFilters(false);
    else renderSpeciesCards();
  }
  if (!$("taxon-view").hidden) applyTaxonFilters();
  $("profiled-filter-status").hidden = !!msProfileIndex && !$("profiled-only").checked;
  $("profiled-filter-status").textContent = msProfileError ?
    "MS file snapshot unavailable; the profiled-only filter cannot be used." :
    "Only this field sample's Directus MS files with OK/published status count; this does not establish successful QC.";
  if (!$("samples-view").hidden) filter({keepMapSelection: true});
}



async function load() {
  try {
    const response = await fetch("data/samples.json", {cache: "no-cache"});
    if (!response.ok) throw new Error(`Snapshot request returned HTTP ${response.status}`);
    const snapshot = await response.json();
    if (!Array.isArray(snapshot.rows) || !Array.isArray(snapshot.taxa) ||
        snapshot.columns?.join(",") !== "directus_id,sample_id,project,recorded_taxon,longitude,latitude,date,taxon_id,resolution_status,observation_subject" ||
        snapshot.taxon_columns?.join(",") !== "id,col_id,scientific_name,authorship,rank,parent_id,backbone_version") {
      throw new Error("Unexpected snapshot format; rebuild it with the current exporter");
    }
    try {
      const gardenResponse = await fetch("data/gardens.json", {cache: "no-cache"});
      if (!gardenResponse.ok) throw new Error(`Garden catalog request returned HTTP ${gardenResponse.status}`);
      gardenCatalog = await gardenResponse.json();
      if (!Array.isArray(gardenCatalog.gardens) || gardenCatalog.gardens.length !== 5) {
        throw new Error("Unexpected five-garden catalog");
      }
      for (const garden of gardenCatalog.gardens) {
        if (!garden.id || !garden.name || !Array.isArray(garden.aliases) || !garden.aliases.length ||
            gardenById.has(garden.id)) throw new Error("Invalid garden catalog entry");
        gardenById.set(garden.id, garden);
        for (const alias of garden.aliases) {
          if (typeof alias !== "string" || gardenByProject.has(alias)) throw new Error("Duplicate garden project alias");
          gardenByProject.set(alias, garden);
        }
      }
    } catch {
      gardenCatalog = null;
      gardenById.clear();
      gardenByProject.clear();
    }
    let source;
    try { source = new URL(snapshot.source); } catch { source = null; }
    if (source && source.protocol === "https:" && !source.username && !source.password && !source.search && !source.hash) {
      directusBase = source.href.replace(/\/$/, "");
    }
    sampleSnapshot = snapshot;
    rows = snapshot.rows;
    window.DBGIObservationSubject.populate($("subject-filter"), rows);
    for (const taxon of snapshot.taxa) taxaById.set(taxon[0], taxon);
    const groups = new Map();
    const familyGroups = new Map();
    for (const row of rows) {
      byId.set(row[0], row);
      const name = row[2] || "";
      if (!groups.has(name)) groups.set(name, { name, count: 0, taxa: new Set(), located: 0 });
      const group = groups.get(name);
      group.count++;
      if (row[7] != null) {
        if (!taxaById.has(row[7])) throw new Error(`Missing resolved Taxa record ${row[7]}`);
        const species = speciesOf(row[7]);
        if (species) {
          if (!speciesRows.has(species[0])) speciesRows.set(species[0], []);
          speciesRows.get(species[0]).push(row);
        }
        group.taxa.add(row[7]);
        const family = familyOf(row[7]);
        if (family) {
          if (!familyGroups.has(family[0])) familyGroups.set(family[0], { id: family[0], count: 0, taxa: new Set() });
          const entry = familyGroups.get(family[0]);
          entry.count++;
          entry.taxa.add(row[7]);
        }
      }
      if (Number.isFinite(row[4]) && Number.isFinite(row[5])) group.located++;
    }
    gardenSummaries = gardenCatalog ? gardenCatalog.gardens.map((garden) => {
      const result = {id: garden.id, name: garden.name, garden: garden.name, key: `g:${garden.id}`,
        projects: garden.aliases, count: 0, samples: 0, taxa: new Set(), located: 0};
      for (const alias of garden.aliases) {
        const group = groups.get(alias);
        if (!group) continue;
        result.count += group.count;
        result.located += group.located;
        for (const taxon of group.taxa) result.taxa.add(taxon);
      }
      result.samples = result.count;
      return result;
    }) : [];
    const otherProjects = [...groups.values()].filter((group) => !gardenByProject.has(group.name))
      .map((group) => ({...group, key: `p:${group.name}`}))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    projects = [...gardenSummaries, ...otherProjects];
    families = [...familyGroups.values()].sort((a, b) => b.count - a.count || taxaById.get(a.id)[2].localeCompare(taxaById.get(b.id)[2]));
    for (const group of projects) {
      const option = element("option", projectName(group.name), $("project"));
      option.value = group.key;
      const taxonOption = element("option", projectName(group.name), $("taxon-project"));
      taxonOption.value = group.key;
      const treemapOption = element("option", projectName(group.name), $("treemap-project"));
      treemapOption.value = group.key;
    }
    if (gardenCatalog) {
      const aliases = element("optgroup", "", $("project"));
      aliases.label = "Individual Directus projects";
      for (const garden of gardenCatalog.gardens) for (const alias of garden.aliases) {
        const option = element("option", `${garden.name} · ${alias}`, aliases);
        option.value = `p:${alias}`;
      }
      const taxonAliases = element("optgroup", "", $("taxon-project"));
      taxonAliases.label = "Individual Directus projects";
      for (const garden of gardenCatalog.gardens) for (const alias of garden.aliases) {
        const option = element("option", `${garden.name} · ${alias}`, taxonAliases);
        option.value = `p:${alias}`;
      }
    }
    $("species-project").append(...[...$("taxon-project").children].slice(1).map((option) => option.cloneNode(true)));
    for (const family of [...families].sort((a, b) => taxaById.get(a.id)[2].localeCompare(taxaById.get(b.id)[2]))) {
      const option = element("option", "", $("family-suggestions"));
      option.value = taxaById.get(family.id)[2];
    }
    $("updated").textContent = `${format(snapshot.total_rows)} source records`;
    void window.DBGIRefreshStatus.load($("refresh-status"), snapshot);
    summary(); explore(); filter(); buildTreemap(); route();
  } catch (error) {
    $("status").textContent = `Could not load the sample snapshot: ${error.message}. Run the snapshot builder or try again later.`;
  }
}

async function loadGardenProgress() {
  const root = $("garden-progress-chart");
  try {
    const response = await fetch("data/garden_progress.json", {cache: "no-cache"});
    if (!response.ok) throw new Error(`Snapshot request returned HTTP ${response.status}`);
    window.GardenProgress.render(root, await response.json());
    addTableControls(root.querySelector("table"), "garden progress rows");
  } catch (error) {
    root.replaceChildren();
    element("p", `Garden progress unavailable: ${error.message}`, root, "muted");
  }
}

$("query").addEventListener("input", () => { selectedTaxonId = null; selectedTreemapTaxa = null; filter(); });
$("project").addEventListener("change", () => { selectedTreemapTaxa = null; filter(); });
$("subject-filter").addEventListener("change", filter);
$("family-query").addEventListener("input", () => { selectedTreemapTaxa = null; filter(); });
$("sample-sort").addEventListener("change", filter);
$("profiled-only").addEventListener("change", () => {
  $("profiled-filter-status").hidden = !$("profiled-only").checked;
  filter();
});
$("clear").addEventListener("click", () => {
  selectedTaxonId = null; selectedTreemapTaxa = null;
  $("query").value = ""; $("project").value = ""; $("subject-filter").value = ""; $("family-query").value = ""; $("sample-sort").value = "source";
  $("profiled-only").checked = false;
  $("profiled-filter-status").hidden = !!msProfileIndex;
  filter();
});
$("treemap-project").addEventListener("change", buildTreemap);
$("family-previous").addEventListener("click", () => { familyPage--; renderFamilies(); });
$("family-next").addEventListener("click", () => { familyPage++; renderFamilies(); });
for (const id of ["family-table-query", "family-table-sort"]) {
  $(id).addEventListener(id === "family-table-query" ? "input" : "change", () => {
    familyPage = 0;
    renderFamilies();
  });
}
new ResizeObserver(() => renderTreemap()).observe($("treemap-canvas"));
$("previous").addEventListener("click", () => { page--; renderPage(); });
$("view-cards").addEventListener("click", () => setSampleView("cards"));
$("view-list").addEventListener("click", () => setSampleView("list"));
$("view-map").addEventListener("click", () => setSampleView("map"));
$("next").addEventListener("click", () => { page++; renderPage(); });
$("species-cards-button").addEventListener("click", () => setSpeciesView("cards"));
$("species-list-button").addEventListener("click", () => setSpeciesView("list"));
$("species-map-button").addEventListener("click", () => setSpeciesView("map"));
for (const id of ["species-query", "species-project", "species-subject", "species-sort", "species-profiled"]) {
  $(id).addEventListener(id === "species-query" ? "input" : "change", applySpeciesFilters);
}
$("species-previous").addEventListener("click", () => {
  speciesPage--;
  renderSpeciesCards();
  $(speciesView === "list" ? "species-list-panel" : "species-cards-panel").scrollIntoView({block: "start"});
});
$("species-next").addEventListener("click", () => {
  speciesPage++;
  renderSpeciesCards();
  $(speciesView === "list" ? "species-list-panel" : "species-cards-panel").scrollIntoView({block: "start"});
});
$("taxon-cards-button").addEventListener("click", () => setTaxonView("cards"));
$("taxon-table-button").addEventListener("click", () => setTaxonView("list"));
$("taxon-map").addEventListener("click", () => setTaxonView("map"));
for (const id of ["taxon-query", "taxon-project", "taxon-subject", "taxon-rank", "taxon-sort", "taxon-profiled"]) {
  $(id).addEventListener(id === "taxon-query" ? "input" : "change", applyTaxonFilters);
}
$("taxon-previous").addEventListener("click", () => {
  taxonPage--;
  renderTaxonCards();
  $("taxon-cards").scrollIntoView({block: "start"});
});
$("taxon-next").addEventListener("click", () => {
  taxonPage++;
  renderTaxonCards();
  $("taxon-cards").scrollIntoView({block: "start"});
});
$("hero-search").addEventListener("submit", (event) => {
  event.preventDefault();
  selectedTaxonId = null;
  selectedTreemapTaxa = null;
  $("query").value = $("hero-query").value;
  $("project").value = "";
  $("subject-filter").value = "";
  $("profiled-only").checked = false;
  $("profiled-filter-status").hidden = !!msProfileIndex;
  $("family-query").value = "";
  filter();
  sampleView = "cards";
  location.hash = "#samples";
});
addEventListener("hashchange", route);
addEventListener("DOMContentLoaded", () => {
  load();
  loadGardenProgress();
});
