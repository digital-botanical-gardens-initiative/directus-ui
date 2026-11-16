"use strict";

// One node per Directus entity or recorded grouping, shared across every relationship.
// Field_Data taxon_ref and Taxa.parent_ref alone determine taxonomic edges.
window.DBGISampleNetwork = (() => {
  const PAGE_SIZE = 24, SCENE_LIMIT = 160;
  const number = new Intl.NumberFormat("en");
  const collator = new Intl.Collator("en", {numeric: true, sensitivity: "base"});
  const make = (tag, parent, text, className) => {
    const el = document.createElement(tag);
    if (text != null) el.textContent = text;
    if (className) el.className = className;
    parent.append(el);
    return el;
  };

  function build(rows, taxaById, gardens) {
    if (!Array.isArray(rows) || !(taxaById instanceof Map)) throw new Error("Invalid Directus network snapshot");
    const nodes = new Map(), edges = [], edgeKeys = new Set();
    const create = (id, label, kind, row = null) => {
      if (nodes.has(id)) return nodes.get(id);
      const node = {id, label, kind, row, count: 0, links: []};
      nodes.set(id, node);
      return node;
    };
    const connect = (from, to, relation) => {
      const key = `${from.id}|${to.id}|${relation}`;
      if (edgeKeys.has(key)) return;
      edgeKeys.add(key);
      const edge = {from, to, relation};
      from.links.push(edge); to.links.push(edge); edges.push(edge);
    };
    const root = create("root", "All field samples", "root");
    const hubs = {
      taxonomy: create("hub:taxonomy", "Directus Taxa", "hub"),
      gardens: create("hub:gardens", "Gardens and projects", "hub"),
      subject: create("hub:subject", "Observation subjects", "hub"),
      geography: create("hub:geography", "Recorded coordinates", "hub")
    };
    for (const hub of Object.values(hubs)) connect(root, hub, "dimension");
    const aliases = new Map();
    for (const garden of gardens?.gardens || []) {
      for (const alias of garden.aliases || []) aliases.set(alias, garden);
    }
    const lineageCache = new Map();
    const lineage = (id) => {
      if (id == null) return [];
      if (lineageCache.has(id)) return lineageCache.get(id);
      const path = [], seen = new Set();
      for (let current = id; current != null;) {
        if (seen.has(current) || !taxaById.has(current)) throw new Error("Incomplete Directus Taxa ancestry");
        seen.add(current);
        const taxon = taxaById.get(current);
        path.push(taxon);
        current = taxon[5];
      }
      lineageCache.set(id, path);
      return path;
    };
    const taxonNode = (taxon) => create(`taxon:${taxon[0]}`, taxon[2], "taxon", taxon);
    const seenSamples = new Set();
    for (const row of rows) {
      if (!Array.isArray(row) || !Number.isSafeInteger(row[0]) || row[0] <= 0 ||
          typeof row[1] !== "string" || !row[1].trim() || seenSamples.has(row[0])) {
        throw new Error("Duplicate or invalid Directus field sample");
      }
      seenSamples.add(row[0]);
      root.count++;
      for (const hub of Object.values(hubs)) hub.count++;
      const sample = create(`sample:${row[0]}`, row[1], "sample", row);
      sample.count = 1;
      const path = lineage(row[7]);
      if (path.length) {
        connect(sample, taxonNode(path[0]), "resolved as");
        for (let index = 0; index < path.length; index++) {
          const current = taxonNode(path[index]);
          current.count++;
          if (index + 1 < path.length) connect(current, taxonNode(path[index + 1]), "parent Taxa");
          else connect(hubs.taxonomy, current, "Taxa root");
        }
      } else {
        const unresolved = create("taxon:unresolved", "No resolved Directus Taxa", "unresolved");
        unresolved.count++;
        connect(sample, unresolved, "unresolved Taxa");
        connect(hubs.taxonomy, unresolved, "unresolved Taxa");
      }
      const projectName = typeof row[2] === "string" && row[2].trim() ? row[2].trim() : null;
      const project = create(`project:${projectName || ""}`, projectName || "No project recorded", "project");
      project.count++;
      connect(sample, project, "recorded project");
      const garden = aliases.get(projectName);
      if (garden) {
        const gardenNode = create(`garden:${garden.id}`, garden.name, "garden");
        gardenNode.count++;
        connect(project, gardenNode, "garden project");
        connect(sample, gardenNode, "botanical garden");
        connect(hubs.gardens, gardenNode, "garden");
      } else {
        const other = create("garden:other", "Other projects / no garden", "garden-group");
        other.count++;
        connect(other, project, "other project");
        connect(hubs.gardens, other, "other projects");
      }
      const recordedSubject = typeof row[9] === "string" ? row[9].trim() : "";
      const subject = create(`subject:${recordedSubject}`, recordedSubject || "Not recorded", "subject");
      subject.count++;
      connect(sample, subject, "observation subject");
      connect(hubs.subject, subject, "recorded subject");
      const lon = row[4], lat = row[5];
      if (typeof lon !== "number" || typeof lat !== "number" || !Number.isFinite(lon) ||
          !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) {
        const missing = create("geo:missing", "No valid recorded coordinates", "coordinate");
        missing.count++;
        connect(sample, missing, "coordinates unavailable");
        connect(hubs.geography, missing, "no coordinates");
      } else {
        let previous = null;
        for (const step of [10, 1, 0.1]) {
          const units = 1 / step;
          const latCell = Math.floor(Math.min(lat, 90 - 1e-7) * units + 1e-9);
          const lonCell = Math.floor(Math.min(lon, 180 - 1e-7) * units + 1e-9);
          const south = latCell / units, west = lonCell / units, digits = step === 0.1 ? 1 : 0;
          const label = `${south.toFixed(digits)}–${(south + step).toFixed(digits)}° lat · ${west.toFixed(digits)}–${(west + step).toFixed(digits)}° lon`;
          const cell = create(`geo:${step}:${latCell}:${lonCell}`, label, "coordinate");
          cell.count++;
          if (previous) connect(previous, cell, "spatial subdivision");
          else connect(hubs.geography, cell, "coordinate region");
          previous = cell;
        }
        connect(sample, previous, "recorded location");
      }
    }
    const other = (edge, node) => edge.from === node ? edge.to : edge.from;
    for (const node of nodes.values()) node.links.sort((a, b) => {
      const left = other(a, node), right = other(b, node);
      return (left.kind === "sample") - (right.kind === "sample") ||
        right.count - left.count || collator.compare(left.label, right.label);
    });
    const otherEnd = (edge, node) => edge.from === node ? edge.to : edge.from;
    const search = (text, limit = 16) => {
      const needle = text.trim().toLocaleLowerCase();
      if (!needle) return [];
      const found = [];
      for (let pass = 0; pass < 2; pass++) for (const node of nodes.values()) {
        if (node.kind === "root" || node.kind === "hub" || (node.kind === "sample") !== (pass === 1)) continue;
        const field = node.kind === "sample" ? node.row[3] || "" : "";
        if (`${node.label} ${field}`.toLocaleLowerCase().includes(needle)) {
          found.push(node);
          if (found.length === limit) return found;
        }
      }
      return found;
    };
    function scene() {
      const shown = new Set([root, ...Object.values(hubs)]);
      const cursors = new Map();
      const attach = (node) => {
        if (shown.has(node)) return;
        const route = [];
        let current = node;
        const seen = new Set();
        while (!shown.has(current) && !seen.has(current)) {
          seen.add(current);
          route.push(current);
          const relation = current.kind === "sample" ? "observation subject" :
            current.kind === "taxon" ? "parent Taxa" :
              current.kind === "project" ? "garden project" :
                current.kind === "coordinate" ? "spatial subdivision" : null;
          const next = current.links.find((edge) => (edge.from === current && edge.relation === relation) ||
            (current.kind === "coordinate" && edge.to === current && edge.relation === "spatial subdivision") ||
            (current.kind === "project" && edge.to === current && edge.relation === "other project"));
          if (next) current = otherEnd(next, current);
          else {
            const hub = current.kind === "sample" || current.kind === "subject" ? hubs.subject :
              current.kind === "taxon" || current.kind === "unresolved" ? hubs.taxonomy :
                current.kind === "coordinate" ? hubs.geography : hubs.gardens;
            if (current === hub) break;
            const link = current.links.find((edge) => otherEnd(edge, current) === hub);
            if (link) current = hub;
            else break;
          }
        }
        for (const part of route.reverse()) shown.add(part);
      };
      const sceneNodes = () => [...shown];
      return {
        shown, sceneNodes,
        select(node) { attach(node); },
        expand(node, relation = "") {
          attach(node);
          const key = `${node.id}|${relation}`;
          const related = relation ? node.links.filter((edge) =>
            `${edge.from === node ? "out" : "in"}|${edge.relation}` === relation) : node.links;
          const start = cursors.get(key) || 0;
          let cursor = start, added = 0;
          while (cursor < related.length && added < PAGE_SIZE && shown.size < SCENE_LIMIT) {
            const target = otherEnd(related[cursor++], node);
            if (!shown.has(target)) { shown.add(target); added++; }
          }
          cursors.set(key, cursor);
          return {added, remaining: related.length - cursor, capped: shown.size >= SCENE_LIMIT};
        },
        focus(node) {
          shown.clear();
          shown.add(root);
          for (const hub of Object.values(hubs)) shown.add(hub);
          cursors.clear();
          attach(node);
          return this.expand(node);
        },
        reset() {
          shown.clear();
          shown.add(root);
          for (const hub of Object.values(hubs)) shown.add(hub);
          cursors.clear();
        },
      };
    }
    return {root, hubs, nodes, edges, search, scene};
  }

  function mount(root, {rows, taxaById, gardens, directusBase, onBrowse} = {}) {
    root.replaceChildren();
    const model = build(rows, taxaById, gardens), scene = model.scene();
    const controls = make("div", root, null, "network-controls");
    const startLabel = make("label", controls, "Explore");
    const start = make("select", startLabel);
    for (const [value, label] of [["root", "All relationships"], ["taxonomy", "Taxonomy"],
      ["gardens", "Gardens / projects"], ["subject", "Observation subjects"], ["geography", "Locations"]]) {
      const option = make("option", start, label); option.value = value;
    }
    const searchLabel = make("label", controls, "Find an entity");
    const query = make("input", searchLabel);
    query.type = "search"; query.placeholder = "Sample ID, Rubiaceae, garden, organ…";
    const reset = make("button", controls, "Clear graph", "secondary"); reset.type = "button";
    const matches = make("div", root, null, "network-matches");
    matches.setAttribute("role", "region"); matches.setAttribute("aria-label", "Search results");
    const summary = make("p", root, null, "network-summary"); summary.setAttribute("role", "status");
    const layout = make("div", root, null, "network-layout");
    const stage = make("div", layout, null, "network-stage");
    const toolbar = make("div", stage, null, "network-toolbar");
    const fitButton = make("button", toolbar, "Fit graph", "secondary");
    const zoomIn = make("button", toolbar, "+", "secondary");
    const zoomOut = make("button", toolbar, "−", "secondary");
    for (const button of [fitButton, zoomIn, zoomOut]) button.type = "button";
    zoomIn.setAttribute("aria-label", "Zoom into graph");
    zoomOut.setAttribute("aria-label", "Zoom out of graph");
    const canvas = make("canvas", stage);
    canvas.setAttribute("aria-label", "Force-directed field-sample graph. Select a node to inspect it on the right, or use the relationship browser.");
    const aside = make("aside", layout, null, "network-panel");
    aside.setAttribute("aria-label", "Selected entity properties, links and relationships");
    const inspector = make("div", aside, null, "network-inspector");
    const related = make("div", aside, null, "network-related");
    const ctx = canvas.getContext("2d");
    let selected = model.root, hovered = null, visible = [], links = [];
    let width = 0, height = 0, scale = 1, panX = 0, panY = 0;
    let frame = 0, ticking = false, drag = null, relation = "", relatedPage = 0, manualViewport = false;
    const typeLabel = {root: "Graph overview", hub: "Relationship category", sample: "Field sample",
      taxon: "Resolved Directus Taxa", unresolved: "Unresolved identification",
      garden: "Botanical garden", "garden-group": "Unassigned garden group",
      project: "Recorded project", subject: "Observation subject", coordinate: "Recorded coordinate region"};
    const color = {root: "#293e52", hub: "#405879", sample: "#6644dd", taxon: "#624bb0",
      unresolved: "#84939b", garden: "#147b77", "garden-group": "#658b86",
      project: "#21918a", subject: "#a65b34", coordinate: "#3d7b9a"};
    const base = typeof directusBase === "string" ? directusBase.replace(/\/$/, "") : "";
    const validBase = /^https:\/\/[^/?#]+(?:\/[^?#]*)?$/.test(base);
    const other = (edge, node) => edge.from === node ? edge.to : edge.from;
    const size = (node) => node.kind === "root" ? 23 : node.kind === "sample" ? 8 :
      node.kind === "hub" ? 18 : Math.min(19, 10 + Math.log2(node.count + 1));

    function link(parent, label, href, external = false) {
      const anchor = make("a", parent, label);
      anchor.href = href;
      if (external) { anchor.target = "_blank"; anchor.rel = "noopener noreferrer"; anchor.referrerPolicy = "no-referrer"; }
      return anchor;
    }
    function property(list, label, value) {
      make("dt", list, label);
      make("dd", list, value == null || value === "" ? "Not recorded" : String(value));
    }
    function properties(node, list) {
      if (node.kind === "sample") {
        const row = node.row;
        property(list, "Directus Field_Data ID", row[0]);
        property(list, "Recorded field name", row[3]);
        property(list, "Project", row[2]);
        property(list, "Observation subject", row[9]);
        property(list, "Collection date", row[6]);
        property(list, "Recorded coordinates (lat, lon)",
          Number.isFinite(row[4]) && Number.isFinite(row[5]) ? `${row[5]}, ${row[4]}` : null);
      } else if (node.kind === "taxon") {
        property(list, "Directus Taxa ID", node.row[0]);
        property(list, "Rank", node.row[4]);
        property(list, "Catalogue of Life usage ID", node.row[1]);
        property(list, "Authorship", node.row[3]);
      } else if (node.kind === "garden") {
        const garden = gardens?.gardens?.find((entry) => entry.id === node.id.slice(7));
        property(list, "Recorded project aliases", garden?.aliases?.join(" · "));
      } else if (node.kind === "project") {
        property(list, "Directus project", node.label === "No project recorded" ? null : node.label);
      } else if (node.kind === "subject") {
        property(list, "Recorded subject", node.id === "subject:" ? null : node.label);
      } else if (node.kind === "coordinate") {
        property(list, "Source", "Directus Field_Data point; regions are display bins");
      }
      if (node.kind !== "sample") property(list, "Linked field samples", number.format(node.count));
      property(list, "Direct relationships", number.format(node.links.length));
    }
    function browseLink(parent, label, scope) {
      if (typeof onBrowse !== "function") return;
      const anchor = link(parent, label, "#samples");
      anchor.addEventListener("click", () => onBrowse(scope));
    }
    function relationKey(edge) {
      return `${edge.from === selected ? "out" : "in"}|${edge.relation}`;
    }
    function relationLabel(edge) {
      const outgoing = edge.from === selected;
      const label = edge.relation === "parent Taxa" ? outgoing ? "Parent Taxa" : "Child Taxa" :
        edge.relation === "spatial subdivision" ? outgoing ? "Subregion" : "Parent region" :
          edge.relation === "resolved as" && !outgoing ? "Identified field samples" :
            edge.relation === "recorded project" && !outgoing ? "Project samples" :
              edge.relation === "botanical garden" && !outgoing ? "Garden samples" :
                edge.relation === "observation subject" && !outgoing ? "Subject samples" :
                  edge.relation === "recorded location" && !outgoing ? "Located samples" :
                    edge.relation;
      return `${label} ${outgoing ? "→" : "←"}`;
    }

    function describe() {
      inspector.replaceChildren(); related.replaceChildren();
      make("p", inspector, typeLabel[selected.kind] || selected.kind, "network-kind");
      const title = make("h3", inspector);
      if (selected.kind === "taxon" && window.DBGIScientificNames) {
        window.DBGIScientificNames.append(title, selected.row[2], selected.row[4], selected.row[3]);
      } else title.textContent = selected.label;
      const actions = make("div", inspector, null, "network-actions");
      if (selected.kind === "sample") {
        link(actions, "Open sample page →", `#sample/${selected.row[0]}`);
        if (validBase) link(actions, "Directus Field_Data ↗",
          `${base}/admin/content/Field_Data/${selected.row[0]}`, true);
      }
      if (selected.kind === "taxon") {
        link(actions, "Explore related samples →",
          `#${selected.row[4] === "species" ? "species" : "taxon"}/${selected.row[0]}`);
        if (typeof selected.row[1] === "string" && /^[A-Za-z0-9]+$/.test(selected.row[1])) {
          link(actions, "Catalogue of Life ↗",
            `https://www.catalogueoflife.org/data/taxon/${selected.row[1]}`, true);
        }
        if (validBase) link(actions, "Directus Taxa ↗",
          `${base}/admin/content/Taxa/${selected.row[0]}`, true);
      }
      if (selected.kind === "garden") {
        const garden = gardens?.gardens?.find((entry) => entry.id === selected.id.slice(7));
        browseLink(actions, "View garden map →", {project: `g:${garden?.id}`, map: true});
        if (garden?.url?.startsWith("https://www.dbgi.org/gardens/")) {
          link(actions, "Garden website ↗", garden.url, true);
        }
      }
      if (selected.kind === "project" && selected.id !== "project:") {
        browseLink(actions, "View project samples →", {project: `p:${selected.id.slice(8)}`});
      }
      if (selected.kind === "subject" && selected.id !== "subject:") {
        browseLink(actions, "Filter samples by subject →", {subject: selected.label});
      }
      if (selected.kind === "root" || selected.kind === "hub") link(actions, "Browse all samples →", "#samples");
      const list = make("dl", inspector, null, "network-properties");
      properties(selected, list);
      const operations = make("div", inspector, null, "network-operations");
      const expandButton = make("button", operations, "Expand neighbors");
      const focusButton = make("button", operations, "Focus here · clear others", "secondary");
      expandButton.type = focusButton.type = "button";
      expandButton.addEventListener("click", () => expandSelected());
      focusButton.addEventListener("click", () => {
        scene.focus(selected); sync(); fit(); describe();
      });
      make("h4", related, "Relationships");
      const total = new Map();
      for (const edge of selected.links) {
        const key = relationKey(edge);
        if (!total.has(key)) total.set(key, {label: relationLabel(edge), count: 0});
        total.get(key).count++;
      }
      const filterLabel = make("label", related, "Show type", "network-relation-filter");
      const filter = make("select", filterLabel);
      const all = make("option", filter, `All types · ${number.format(selected.links.length)}`); all.value = "";
      for (const [key, group] of total) {
        const option = make("option", filter, `${group.label} · ${number.format(group.count)}`);
        option.value = key;
      }
      filter.value = relation;
      filter.addEventListener("change", () => { relation = filter.value; relatedPage = 0; describe(); });
      const edges = relation ? selected.links.filter((edge) => relationKey(edge) === relation) : selected.links;
      const pages = Math.max(1, Math.ceil(edges.length / PAGE_SIZE));
      relatedPage = Math.min(relatedPage, pages - 1);
      make("p", related, `${number.format(edges.length)} direct ${edges.length === 1 ? "relationship" : "relationships"}. Select a neighbor to inspect it; use Expand to add it to the graph.`, "network-related-hint");
      const neighbors = make("ul", related);
      for (const edge of edges.slice(relatedPage * PAGE_SIZE, (relatedPage + 1) * PAGE_SIZE)) {
        const node = other(edge, selected);
        const item = make("li", neighbors);
        const button = make("button", item, null, "network-neighbor");
        button.type = "button";
        make("span", button, relationLabel(edge), "network-relation-name");
        make("span", button, node.label, "network-neighbor-name");
        make("span", button, number.format(node.count), "network-neighbor-count");
        button.addEventListener("click", () => select(node));
      }
      const pager = make("div", related, null, "network-pages");
      const back = make("button", pager, "← Previous", "secondary");
      back.type = "button"; back.disabled = relatedPage === 0;
      make("span", pager, `${relatedPage + 1} / ${pages}`);
      const next = make("button", pager, "Next →", "secondary");
      next.type = "button"; next.disabled = relatedPage + 1 >= pages;
      back.addEventListener("click", () => { relatedPage--; describe(); });
      next.addEventListener("click", () => { relatedPage++; describe(); });
    }
    function seed(node) {
      if (Number.isFinite(node.x)) return;
      let attached = null;
      for (const edge of node.links) {
        const neighbor = other(edge, node);
        if (scene.shown.has(neighbor) && Number.isFinite(neighbor.x)) { attached = neighbor; break; }
      }
      let hash = 0;
      for (let index = 0; index < node.id.length; index++) hash = (hash * 31 + node.id.charCodeAt(index)) | 0;
      const angle = (hash >>> 0) * 2.399963229728653;
      node.x = (attached?.x || 0) + Math.cos(angle) * (attached ? 94 : 115);
      node.y = (attached?.y || 0) + Math.sin(angle) * (attached ? 94 : 115);
      node.vx = node.vy = 0;
    }
    function sync() {
      visible = scene.sceneNodes();
      for (const node of visible) seed(node);
      links = [];
      for (const node of visible) for (const edge of node.links) {
        if (edge.from === node && scene.shown.has(edge.to)) links.push(edge);
      }
      summary.textContent = `${number.format(model.root.count)} unique field samples · ${number.format(visible.length)} entities and ${number.format(links.length)} relationships in this view. Select a node to inspect it on the right; Expand adds up to ${PAGE_SIZE} neighbors.`;
      frame = 0; animate();
    }
    function physics() {
      for (let i = 0; i < visible.length; i++) {
        const a = visible[i];
        for (let j = i + 1; j < visible.length; j++) {
          const b = visible[j], dx = a.x - b.x, dy = a.y - b.y;
          const distance = Math.max(16, dx * dx + dy * dy);
          const push = Math.min(3, 2700 / distance) / Math.sqrt(distance);
          a.vx += dx * push; a.vy += dy * push;
          b.vx -= dx * push; b.vy -= dy * push;
        }
      }
      for (const edge of links) {
        const a = edge.from, b = edge.to, dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const pull = (dist - (a.kind === "sample" || b.kind === "sample" ? 115 : 130)) * .012 / dist;
        a.vx += dx * pull; a.vy += dy * pull;
        b.vx -= dx * pull; b.vy -= dy * pull;
      }
      for (const node of visible) {
        if (drag?.node === node) continue;
        node.vx = (node.vx - node.x * .0007) * .76;
        node.vy = (node.vy - node.y * .0007) * .76;
        node.x += node.vx; node.y += node.vy;
      }
    }
    function draw() {
      if (!ctx || !width || !height) return;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.translate(width / 2 + panX, height / 2 + panY);
      ctx.scale(scale, scale);
      for (const edge of links) {
        ctx.beginPath(); ctx.moveTo(edge.from.x, edge.from.y); ctx.lineTo(edge.to.x, edge.to.y);
        ctx.strokeStyle = edge.from === selected || edge.to === selected ? "#6552a3" : "#bdcbd3";
        ctx.lineWidth = (edge.from === selected || edge.to === selected ? 2.2 : 1.05) / scale;
        ctx.stroke();
      }
      for (const node of visible) {
        const radius = size(node);
        ctx.beginPath(); ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = color[node.kind] || "#456b79"; ctx.fill();
        if (node === selected) {
          ctx.strokeStyle = "#f3aa2f"; ctx.lineWidth = 3 / scale; ctx.stroke();
        }
        if (node.kind !== "sample" && radius * scale >= 13) {
          ctx.fillStyle = "white"; ctx.font = `${10 / scale}px system-ui`;
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(number.format(node.count), node.x, node.y, radius * 1.8);
        }
        if (node === selected || node === hovered ||
            (width >= 620 && visible.length <= 18 && node.kind !== "sample") ||
            (width < 620 && visible.length <= 7 && node.kind === "hub")) {
          ctx.fillStyle = "#263944"; ctx.font = `${12 / scale}px system-ui`;
          ctx.textAlign = "center"; ctx.textBaseline = "top";
          ctx.fillText(node.label, node.x, node.y + radius + 5 / scale, 170 / scale);
        }
      }
    }
    function animate() {
      if (ticking || !ctx || !width || root.closest(".view")?.hidden) return;
      ticking = true;
      requestAnimationFrame(function tick() {
        if (root.closest(".view")?.hidden) { ticking = false; return; }
        physics(); draw();
        if (++frame < 135 || drag?.node) requestAnimationFrame(tick);
        else { ticking = false; if (!manualViewport) fit(); }
      });
    }
    function resize() {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      width = rect.width; height = rect.height;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      draw(); frame = 0; animate();
    }
    function fit() {
      manualViewport = false;
      if (!width || !height) return;
      let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
      for (const node of visible) {
        left = Math.min(left, node.x); right = Math.max(right, node.x);
        top = Math.min(top, node.y); bottom = Math.max(bottom, node.y);
      }
      scale = Math.min(1.5, (width - 110) / Math.max(90, right - left),
        (height - 110) / Math.max(90, bottom - top));
      scale = Math.max(.15, scale);
      panX = -scale * (left + right) / 2; panY = -scale * (top + bottom) / 2;
      draw();
    }
    function expandSelected() {
      const added = scene.expand(selected, relation);
      sync(); fit();
      if (added.capped) summary.textContent += " Scene limit reached; focus an entity to inspect another neighborhood.";
      else if (!added.added) summary.textContent += " No additional neighbors for this relationship.";
    }
    function select(node) {
      if (!node) return;
      scene.select(node); selected = node; relation = ""; relatedPage = 0;
      sync(); describe(); fit();
    }
    function hit(event) {
      const bounds = canvas.getBoundingClientRect();
      const x = (event.clientX - bounds.left - width / 2 - panX) / scale;
      const y = (event.clientY - bounds.top - height / 2 - panY) / scale;
      let nearest = null, distance = Infinity;
      for (const node of visible) {
        const dx = node.x - x, dy = node.y - y, d = dx * dx + dy * dy;
        const reach = Math.max(size(node), 12 / scale);
        if (d < reach * reach && d < distance) { nearest = node; distance = d; }
      }
      return nearest;
    }
    function searchResults() {
      matches.replaceChildren();
      for (const node of model.search(query.value)) {
        const button = make("button", matches, null);
        button.type = "button";
        make("span", button, typeLabel[node.kind], "network-match-kind");
        make("strong", button, node.label);
        button.addEventListener("click", () => { select(node); matches.replaceChildren(); });
      }
    }
    start.addEventListener("change", () => {
      const node = start.value === "root" ? model.root : model.hubs[start.value];
      select(node); scene.expand(node); sync(); describe(); fit();
    });
    query.addEventListener("input", searchResults);
    query.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      const match = model.search(query.value, 1)[0];
      if (match) { event.preventDefault(); select(match); matches.replaceChildren(); }
    });
    reset.addEventListener("click", () => {
      scene.reset(); selected = model.root; relation = ""; relatedPage = 0;
      query.value = ""; start.value = "root"; matches.replaceChildren();
      panX = panY = 0; scale = 1; sync(); describe(); fit();
    });
    fitButton.addEventListener("click", fit);
    zoomIn.addEventListener("click", () => { manualViewport = true; scale = Math.min(5, scale * 1.2); draw(); });
    zoomOut.addEventListener("click", () => { manualViewport = true; scale = Math.max(.15, scale / 1.2); draw(); });
    canvas.addEventListener("pointerdown", (event) => {
      const node = hit(event);
      drag = {node, x: event.clientX, y: event.clientY, panX, panY, moved: false};
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (drag) {
        if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 4) drag.moved = true;
        if (drag.moved && drag.node) {
          drag.node.x += (event.clientX - drag.x) / scale;
          drag.node.y += (event.clientY - drag.y) / scale;
          drag.node.vx = drag.node.vy = 0;
          drag.x = event.clientX; drag.y = event.clientY;
          manualViewport = true; frame = 0; animate(); draw();
        } else if (drag.moved) {
          panX = drag.panX + event.clientX - drag.x;
          panY = drag.panY + event.clientY - drag.y;
          manualViewport = true; draw();
        }
      } else {
        hovered = hit(event);
        canvas.title = hovered ? `${typeLabel[hovered.kind]} · ${hovered.label} · ${number.format(hovered.count)} samples` : "";
        canvas.style.cursor = hovered ? "pointer" : "grab"; draw();
      }
    });
    canvas.addEventListener("pointerup", () => {
      if (drag?.moved) canvas.dataset.dragged = "1";
      drag = null;
    });
    canvas.addEventListener("click", (event) => {
      if (canvas.dataset.dragged) { delete canvas.dataset.dragged; return; }
      const node = hit(event);
      if (node) select(node);
    });
    canvas.addEventListener("dblclick", (event) => {
      const node = hit(event);
      if (node) { select(node); expandSelected(); describe(); }
    });
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      const next = Math.max(.15, Math.min(5, scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
      const bounds = canvas.getBoundingClientRect();
      const x = event.clientX - bounds.left - width / 2;
      const y = event.clientY - bounds.top - height / 2;
      panX = x - (x - panX) * next / scale;
      panY = y - (y - panY) * next / scale;
      manualViewport = true; scale = next; draw();
    }, {passive: false});
    new ResizeObserver(resize).observe(stage);
    sync(); resize(); fit(); describe();
    return {resize};
  }
  return Object.freeze({build, mount});
})();
