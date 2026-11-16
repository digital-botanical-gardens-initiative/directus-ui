# Changelog

Noteworthy user- and contributor-visible changes go under **Unreleased** until a maintainer makes an actual release. Follow [CONTRIBUTING.md](CONTRIBUTING.md#changelog) to add a short entry to Added, Changed, Fixed or Removed; do not log automatic snapshot timestamps, credentials or unverified upstream data. Earlier work is summarized below from the available commits and current implementation; it is **not** an exact release timeline.

## Unreleased

### Added

- Contributor instructions for credential-free previews, fork/branch/PR workflow, least-privilege Directus refresh and GitHub Pages deployment.
- Separate PR checks for Python exporters and browser-module tests that work without Directus secrets.
- A short browser smoke checklist and a detailed technical reference linked from the README.
- Open licensing for original code/docs (MIT), DBGI/EMI data (CC0), and separately attributed DBGI imagery and weather icons (CC BY 4.0).

### Changed

- Browser JavaScript and CSS are organized under `assets/js/` and `assets/css/`, with Pages staging and test imports updated to match.
- README now focuses on getting started and access requirements; detailed feature, provenance and privacy notes live in `docs/technical-reference.md`.

## Earlier development — approximate, undated

- **Directus-backed foundation:** Built a lightweight GitHub Pages dashboard from reviewed, read-only `Field_Data` and `Taxa` snapshots. Sample IDs and taxonomic ancestry stay tied to Directus records; Catalogue of Life links provide public references rather than replacing the Directus hierarchy.
- **Collection exploration:** Added searchable sample cards, sortable and paginated lists, and maps with zoom-dependent clustering and individually selectable recorded coordinates at maximum zoom. Added species, upper-taxon and family drilldowns, five botanical-garden groupings, taxonomic treemaps and garden collection/extraction/profiling progress.
- **Specimen and MS lineage:** Linked field samples to dried material, extracts, aliquots, MS records, instruments and injection-method polarity. Added sample-specific versus species-wide profiling evidence, GNPS2 LC–MS views, cross-sample group A/B comparison and BPI/XIC controls.
- **Chemical references:** Added optional LOTUS searches based on an exact CoL-to-Wikidata species match or a verified Directus genus, plus a ChemCalc adduct helper for copying m/z values into GNPS2. These external references do not establish measured compounds.
- **People and curation:** Added a collector leaderboard with linked samples, profiles and permitted portraits; linked Directus curation observations to iNaturalist photos and community-name review, including an observations-with-comments filter. Separate species photo references never replace sample observation evidence.
- **Connected context:** Added a navigable sample network linking taxa, organs, projects, gardens and locations; recorded observation-subject icons; historical weather estimates with provenance; and local DBGI/garden imagery.
- **Publication and provenance:** Added scheduled GitHub Pages refresh of six Directus-derived snapshots using a read-only secret, explicit freshness reporting and tests. Optional Wikidata reconciliation remains a separate, reviewed export rather than a daily source of sample identities.
