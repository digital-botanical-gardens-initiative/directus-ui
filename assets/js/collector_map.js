"use strict";

/* Map resolved field samples for a collector or Taxa lineage at their recorded GeoJSON points. */
(function () {
  const ZOOM_PRECISE = 19;
  const number = new Intl.NumberFormat("en");

  function point(row) {
    return Number.isFinite(row[4]) && Number.isFinite(row[5]) &&
      Math.abs(row[4]) <= 180 && Math.abs(row[5]) <= 90;
  }

  function node(tag, text, parent, className) {
    const result = document.createElement(tag);
    result.textContent = text;
    if (className) result.className = className;
    if (parent) parent.append(result);
    return result;
  }

  function mount({root, observations, loadLeaflet, renderScientificTaxon,
    scopeLabel = "species", taxonHref = (taxon) => `#species/${taxon[0]}`}) {
    const located = observations.filter(({row}) => point(row));
    root.replaceChildren();
    node("p", `${number.format(located.length)} geolocated ${scopeLabel} ${located.length === 1 ? "sample" : "samples"}. Points use recorded coordinates; aggregates split one zoom level per click, and individual samples appear at maximum zoom.`, root, "collectors__map-note");
    const surface = node("div", "", root, "collectors__map");
    surface.setAttribute("role", "region");
    surface.setAttribute("aria-label", `Map of ${scopeLabel} samples`);
    const status = node("p", "", root, "collectors__map-status");
    status.setAttribute("role", "status");
    let active = true;
    let map;
    let layer;

    function openSample(marker, observation, displaced) {
      const {row, taxon} = observation;
      const popup = node("div", "", null);
      if (taxon) {
        const species = node("a", "", popup);
        renderScientificTaxon(species, taxon);
        species.href = taxonHref(taxon);
      } else node("p", `Recorded field name (no resolved species): ${row[3] || "not recorded"}`, popup);
      const sample = node("p", "", popup);
      window.DBGIObservationSubject.inline(sample, row[9]);
      const sampleLink = node("a", row[1], sample);
      sampleLink.href = `#sample/${row[0]}`;
      node("p", `${row[5]}, ${row[4]} (recorded latitude, longitude)`, popup);
      if (displaced) node("p", "Display marker separated from coincident observations; its line ends at the recorded coordinate.", popup);
      L.popup({maxWidth: 320}).setLatLng(marker.getLatLng()).setContent(popup).openOn(map);
    }

    function render() {
      if (!active || !map) return;
      layer.clearLayers();
      const bounds = map.getBounds();
      const precise = map.getZoom() >= ZOOM_PRECISE;
      const buckets = new Map();
      for (const observation of located) {
        const {row} = observation;
        if (!bounds.contains([row[5], row[4]])) continue;
        const screen = precise ? null : map.latLngToContainerPoint([row[5], row[4]]);
        const key = precise ? `${row[4]},${row[5]}` : `${Math.floor(screen.x / 40)}:${Math.floor(screen.y / 40)}`;
        if (!buckets.has(key)) buckets.set(key, {members: [], latitude: 0, longitude: 0});
        const bucket = buckets.get(key);
        bucket.members.push(observation);
        bucket.latitude += row[5];
        bucket.longitude += row[4];
      }
      for (const bucket of buckets.values()) {
        const count = bucket.members.length;
        if (precise && count > 1) {
          const first = bucket.members[0].row;
          const origin = [first[5], first[4]];
          const anchor = map.latLngToLayerPoint(origin);
          bucket.members.forEach((observation, index) => {
            const radius = 12 + 9 * Math.sqrt(index);
            const angle = index * 2.399963229728653;
            const display = map.layerPointToLatLng(L.point(anchor.x + Math.cos(angle) * radius,
              anchor.y + Math.sin(angle) * radius));
            L.polyline([origin, display], {color: "#3e503c", weight: 1, opacity: 0.4, interactive: false}).addTo(layer);
            const marker = L.marker(display, {
              icon: L.divIcon({className: "sample-point", iconSize: [8, 8]}),
              title: `${observation.row[1]} · ${observation.taxon?.[2] || observation.row[3] || "no resolved species"}`,
            }).addTo(layer);
            marker.on("click", () => openSample(marker, observation, true));
          });
          continue;
        }
        const first = bucket.members[0];
        const location = precise || count === 1 ? [first.row[5], first.row[4]] :
          [bucket.latitude / count, bucket.longitude / count];
        const size = count > 99 ? 42 : count > 9 ? 34 : 30;
        const marker = L.marker(location, {
          icon: count > 1 && !precise ? L.divIcon({className: "sample-cluster", html: `<span>${count}</span>`, iconSize: [size, size]}) :
            L.divIcon({className: "sample-point", iconSize: [8, 8]}),
          title: count === 1 ? `${first.row[1]} · ${first.taxon?.[2] || first.row[3] || "no resolved species"}` : `${number.format(count)} ${scopeLabel} samples`,
        }).addTo(layer);
        marker.on("click", () => {
          if (count > 1 && !precise) {
            map.setView(marker.getLatLng(), map.getZoom() + 1);
          } else openSample(marker, first, false);
        });
      }
    }

    const ready = located.length ? Promise.resolve().then(loadLeaflet).then(() => {
      if (!active) return;
      map = L.map(surface, {scrollWheelZoom: false});
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: ZOOM_PRECISE,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
      }).addTo(map);
      layer = L.layerGroup().addTo(map);
      map.on("moveend", render);
      let south = 90, north = -90, west = 180, east = -180;
      for (const {row} of located) {
        south = Math.min(south, row[5]);
        north = Math.max(north, row[5]);
        west = Math.min(west, row[4]);
        east = Math.max(east, row[4]);
      }
      const bounds = L.latLngBounds([[south, west], [north, east]]);
      map.invalidateSize();
      map.fitBounds(bounds, {padding: [24, 24], maxZoom: 14, animate: false});
      render();
    }).catch((error) => {
      if (active) status.textContent = `${error.message}. The sample list remains available.`;
    }) : Promise.resolve().then(() => {
      status.textContent = `No ${scopeLabel} samples have valid coordinates. The list remains available.`;
    });

    return {ready, destroy() {
      active = false;
      if (map) map.remove();
      root.replaceChildren();
    }};
  }

  window.DBGICollectorMap = Object.freeze({mount});
})();
