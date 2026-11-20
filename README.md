# DBGI and EMI sample explorers

A shared, read-only static dashboard for Directus field samples. The **DBGI site** publishes only the five botanical gardens; the **EMI site** publishes all projects. Search samples, browse the Directus Taxa hierarchy, explore gardens and collectors on maps, and inspect recorded processing, iNaturalist observations and MS files. Directus is the source of collection and processing records. External LOTUS, CoL, GNPS2, weather and iNaturalist services provide clearly labelled references or estimates.

**[DBGI · five gardens](https://www.dbgi.org/directus-ui/)** · **[EMI · all projects](https://www.earthmetabolome.org/directus-ui/)**

Both sites share features and Directus exports, but have separate presentation: DBGI starts with five garden cards; EMI uses the Earth Metabolome banner and a project overview. On EMI, expand **DBGI** to choose one of its five gardens, or open a separate Fung, Champex gradient, ViNEsh, Macedonia or Manaslu project card. The other observed Directus projects remain available; presentation names do not replace their recorded project codes.

## Preview locally (no Directus account needed)

Requirements: Python 3 for the small stdlib-only staging command and local HTTP server. The site itself is plain HTML, CSS and JavaScript; no package install.

```sh
git clone https://github.com/digital-botanical-gardens-initiative/directus-ui.git
cd directus-ui
python3 scripts/stage_site.py --site dbgi --output site-dbgi
python3 scripts/stage_site.py --site emi --output site-emi
python3 -m http.server 8000
```

Open <http://localhost:8000/site-dbgi/> and <http://localhost:8000/site-emi/> to preview the two actual Pages variants. Committed `data/*.json` snapshots work without authentication; stage into fresh output directories. The root `index.html` is the shared DBGI-authored input and is **not** a faithful preview of EMI branding. Do **not** open a site with `file://`: browsers block its JSON requests. Internet access is needed only for external maps, images, weather and linked third-party services. The browser never authenticates to Directus or receives a Directus token.

## Directus access: what is actually required?

| Task | Access required |
| --- | --- |
| Browse the live site, preview committed snapshots, change UI or run tests | **None.** No `.env`, Directus account or GitHub secret. |
| Regenerate the field-sample and taxonomy snapshot | A **read-only Directus token** with `Field_Data` and `Taxa` row/field and `id` count-aggregate access. `Taxa` is not anonymously readable. |
| Regenerate the complete daily snapshot set | The same token plus `People`, `Containers`, `Dried_Samples_Data`, `Extraction_Data`, `Aliquoting_Data`, `MS_Data`, `Instruments`, `Injection_Methods`, the actual collection behind `Instruments.instrument_model`, and `Curation_Data`, for the fields projected by `scripts/`. Some processing and curation endpoints currently permit anonymous reads, but the automated refresh passes one read-only token throughout. |
| Configure the repository's daily GitHub Pages refresh | A maintainer creates a dedicated, **non-admin static token** and stores it as the GitHub Actions repository secret `DIRECTUS_READ_TOKEN`. PRs and forks do not need this secret. |

Only exported, reviewed fields are written to same-origin snapshots; credentials stay out of the repository and Pages artifact. `DIRECTUS_INSTANCE` can override the default `https://emi-collection.unifr.ch/directus` URL for local exporters. For the exact scopes, authentication checks, refresh order and Pages setup, follow [CONTRIBUTING](CONTRIBUTING.md#directus-access-and-refresh). **Do not move or commit an admin `.env` file.**

## Where to work

- `index.html`: static entry point and views.
- `assets/js/`, `assets/css/`: shared browser code and styles; `assets/` also contains the locally hosted DBGI and EMI hero images, marks, garden images and portraits. Keep browser URLs relative to `index.html` and CSS image URLs relative to their stylesheet.
- `data/`: committed, reviewable full Directus-derived snapshots. **Edit `data/gardens.json` to assign each Directus project alias to exactly one of the five gardens** (e.g. `jbn`, `jbn-new` → Neuchâtel); the DBGI deployment uses this catalog to scope its published snapshots and replaces project codes with garden identities. `data/refresh.json` is a generated, ignored deployment marker. No visitor-facing credentials.
- `scripts/`: Python exporters and the optional CoL → Wikidata reconciler.
- `tests/`: Node.js browser-module tests and Python exporter tests.
- `.github/workflows/`: shared GitHub Pages build, DBGI publishing caller and contributor checks.

The shared Pages workflow refreshes six Directus snapshots when the caller's read-only secret is configured, then stages **one selected scope per deployment** from the same source code: `.github/workflows/pages.yml` selects `site: dbgi` and publishes only linked garden samples, while the Earth Metabolome caller defaults to `site: emi` and publishes all projects. DBGI garden aliases are **grouping instructions**, not separate choices on that website; all linked processing, MS, curation and collector data are scoped before publication. Each artifact contains only `index.html`, `LICENSE`, `LICENSING.md`, `assets/` and approved `data/` files. Without a token a workflow warns and stages committed snapshots under the same site scope without claiming a completed refresh. `data/wikidata_taxa.json` is *not* refreshed daily. DBGI starts daily at **08:30 Europe/Zurich**, subject to GitHub scheduling delays. The source repository itself contains the all-project snapshots for EMI; the DBGI Pages artifact—not the source repository—is garden-scoped.

## Contribute and learn more

- [CONTRIBUTING.md](CONTRIBUTING.md) — fork or branch, open a PR, run tests, request Directus access, and update the changelog.
- [CHANGELOG.md](CHANGELOG.md) — noteworthy changes and the Unreleased section.
- [Technical reference](docs/technical-reference.md) — detailed provenance, taxonomy, feature behavior, privacy and external-service limitations.
- [Manual checks](docs/manual-checks.md) — browser smoke checks for sample, taxonomy, collector, map and MS routes.
- [Earth Metabolome deployment](docs/earth-metabolome-deployment.md) — create the tiny destination repository and call the shared workflow; no duplicate application source.

For a quick check after editing:

```sh
python3 -m unittest discover -s tests
node --test tests/test_*.js
```

The tests use Python 3.10+ and Node.js 20+; they do not require Directus credentials. See [CONTRIBUTING](CONTRIBUTING.md#checks-and-preview) for the PR checklist.

## License

Original software and documentation: [MIT](LICENSE). DBGI/EMI snapshot data: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). DBGI website imagery and embedded Font Awesome icon paths retain their [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) attribution and source terms. See [LICENSING.md](LICENSING.md) for precise file scopes, credits and third-party limits; MIT does not relicense data or photographs.
