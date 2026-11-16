# DBGI sample explorer

A read-only, static dashboard for Digital Botanical Gardens Initiative field samples. Search samples, browse the **Directus Taxa hierarchy** by family or species, explore gardens and collectors on maps, and inspect recorded processing, iNaturalist observations and MS files. Directus is the source of collection and processing records. External LOTUS, CoL, GNPS2, weather and iNaturalist services provide clearly labelled references or estimates, not new Directus facts.

**[Open the published dashboard](https://digital-botanical-gardens-initiative.github.io/directus-ui/)**

## Preview locally (no Directus account needed)

Requirements: Python 3 for the local HTTP server. The site itself is plain HTML, CSS and JavaScript; no package install or build step.

```sh
git clone https://github.com/digital-botanical-gardens-initiative/directus-ui.git
cd directus-ui
python3 -m http.server 8000
```

Open <http://localhost:8000/>. The committed `data/*.json` snapshots supply the dashboard. Do **not** open `index.html` with `file://`: browsers block its JSON requests. Internet access is needed only for external maps, images, weather and linked third-party services. The browser never authenticates to Directus or receives a Directus token.

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
- `assets/js/`, `assets/css/`: browser code and styles; `assets/` also contains locally served images and portraits. Keep browser URLs relative to `index.html` and CSS image URLs relative to their stylesheet.
- `data/`: committed, reviewable Directus-derived snapshots and the garden catalog; `data/refresh.json` is a generated, ignored deployment marker. No visitor-facing credentials.
- `scripts/`: Python exporters and the optional CoL → Wikidata reconciler.
- `tests/`: Node.js browser-module tests and Python exporter tests.
- `.github/workflows/`: static Pages publication and contributor checks.

The CI deployment stages **only** `index.html`, `LICENSE`, `LICENSING.md`, `assets/` and selected `data/` files. On pushes to `main`, manual dispatch and its daily **08:30 Europe/Zurich scheduled start**, it refreshes six Directus snapshots when the secret is configured; without the secret it warns and publishes the committed snapshots without claiming a completed refresh. `data/wikidata_taxa.json` is *not* refreshed daily. The dashboard's freshness indicator reports actual snapshot times, not a guarantee of schedule completion.

## Contribute and learn more

- [CONTRIBUTING.md](CONTRIBUTING.md) — fork or branch, open a PR, run tests, request Directus access, and update the changelog.
- [CHANGELOG.md](CHANGELOG.md) — noteworthy changes and the Unreleased section.
- [Technical reference](docs/technical-reference.md) — detailed provenance, taxonomy, feature behavior, privacy and external-service limitations.
- [Manual checks](docs/manual-checks.md) — browser smoke checks for sample, taxonomy, collector, map and MS routes.

For a quick check after editing:

```sh
python3 -m unittest discover -s tests
node --test tests/test_*.js
```

The tests use Python 3.10+ and Node.js 20+; they do not require Directus credentials. See [CONTRIBUTING](CONTRIBUTING.md#checks-and-preview) for the PR checklist.

## License

Original software and documentation: [MIT](LICENSE). DBGI/EMI snapshot data: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). DBGI website imagery and embedded Font Awesome icon paths retain their [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) attribution and source terms. See [LICENSING.md](LICENSING.md) for precise file scopes, credits and third-party limits; MIT does not relicense data or photographs.
