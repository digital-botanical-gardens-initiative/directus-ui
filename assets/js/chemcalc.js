"use strict";

window.ChemCalc = (() => {
  const base = "https://www.chemcalc.org/";

  function element(tag, parent, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    parent.append(node);
    return node;
  }

  function render(root, {comparison = false} = {}) {
    // Unload the previous formula's external page on navigation.
    root.replaceChildren();
    const panel = element("div", root, null, "chemcalc-panel");
    element("h3", panel, "Calculate an adduct m/z");
    element("p", panel, comparison
      ? "Paste a molecular formula from LOTUS, not its neutral mass. Copy the calculated ion m/z into Plot XIC in GNPS2 below for the selected comparison files. An XIC peak alone does not identify a compound."
      : "Paste a molecular formula from LOTUS, not its neutral mass. ChemCalc calculates the ion m/z; use it in the GNPS2 XIC search on a profiled field sample. An XIC peak alone does not identify a compound.");

    const form = element("form", panel, null, "chemcalc-form");
    const formulaLabel = element("label", form, "Molecular formula from LOTUS");
    const formula = element("input", formulaLabel);
    formula.type = "text";
    formula.placeholder = "e.g. C8H10N4O2";
    formula.maxLength = 128;
    formula.required = true;
    formula.autocomplete = "off";
    const ionLabel = element("label", form, "Ionization / adduct");
    const ion = element("input", ionLabel);
    ion.type = "text";
    ion.value = "H+";
    ion.maxLength = 40;
    ion.required = true;
    ion.autocomplete = "off";
    const submit = element("button", form, "Calculate with ChemCalc");
    submit.type = "submit";

    const result = element("div", panel, null, "chemcalc-result");
    result.hidden = true;
    element("p", panel, "Calculating sends your formula and adduct to chemcalc.org, which sees your IP address. Nothing is sent until you click. This is not a measured DBGI result.", "chemcalc-note");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const mf = formula.value.trim();
      const ionizations = ion.value.trim();
      if (!mf || !ionizations) return;
      const url = new URL(base);
      url.searchParams.set("ionizations", ionizations);
      url.searchParams.set("mf", mf);
      const frame = document.createElement("iframe");
      frame.title = `ChemCalc adduct calculator for ${mf}`;
      frame.loading = "lazy";
      frame.referrerPolicy = "no-referrer";
      frame.src = url.href;
      const source = document.createElement("p");
      const link = element("a", source, "Open this calculation on ChemCalc ↗", "chemcalc-link");
      link.href = url.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.referrerPolicy = "no-referrer";
      result.replaceChildren(frame, source);
      result.hidden = false;
    });
    root.hidden = false;
  }

  return Object.freeze({render});
})();
