# Contributing to the DBGI sample explorer

Thanks for helping improve a **read-only, GitHub Pages-hosted** view of Directus data. Start with the [README](README.md) for a credential-free preview and repository map; the [technical reference](docs/technical-reference.md) describes provenance and privacy decisions. The published Directus `Taxa.parent_ref` chain is the only taxonomic hierarchy; do not infer one from field names.

## Fork or branch, then open a PR

1. If you **do not** have write access, fork [digital-botanical-gardens-initiative/directus-ui](https://github.com/digital-botanical-gardens-initiative/directus-ui) using **Fork** on GitHub and clone **your fork**. Contributors with write access can clone the canonical repository instead. No Directus account or secret is needed for UI, documentation or test contributions.
2. Start a focused branch from the current `main`. With a fork:

   ```sh
   git clone https://github.com/YOUR-USERNAME/directus-ui.git
   cd directus-ui
   git remote add upstream https://github.com/digital-botanical-gardens-initiative/directus-ui.git
   git fetch upstream
   git switch -c feature/short-description upstream/main
   ```

   With direct write access, clone the canonical repository and run `git switch -c feature/short-description origin/main`. Avoid committing directly to `main` or force-pushing a shared branch.
3. Make the change, run the [checks](#checks-and-preview), and add an [Unreleased changelog entry](#changelog). If your change affects published snapshots, coordinate with a maintainer and review every exported field for public release before staging it.
4. Stage **only** intended paths and inspect them before pushing:

   ```sh
   git add README.md CONTRIBUTING.md CHANGELOG.md  # replace with your actual changed paths
   git diff --cached --stat
   git diff --cached --check
   git commit -m "Describe the user-visible change"
   git push -u origin feature/short-description
   ```

5. On GitHub, select **Compare & pull request** (or **New pull request → compare across forks**), base repository `digital-botanical-gardens-initiative/directus-ui`, base branch `main`, and your branch as head. Describe the behavior, Directus provenance or permission impact, tests and browser smoke performed, and any external-service limitations. Link related issues if applicable. Address review feedback on the same branch; merge is a maintainer decision. For a fork PR, the Pages deployment secret is **not** available, and PR checks must not require it. After `main` merges, the deployment workflow publishes the site.

To sync a fork later: `git fetch upstream` and start your next branch from `upstream/main`. Do not copy maintainer secrets into the fork.

## Checks and preview

Run from the repository root (Python **3.10+**, Node.js **20+**; no pip/npm dependencies):

```sh
python3 -m unittest discover -s tests
node --test tests/test_*.js
python3 scripts/stage_site.py --site dbgi --output site-dbgi
python3 scripts/stage_site.py --site emi --output site-emi
python3 -m http.server 8000
```

Open <http://localhost:8000/site-dbgi/> and <http://localhost:8000/site-emi/>; committed `data/*.json` snapshots work without authentication. Stage into fresh directories to preview the exact Pages scopes, HTML identities and locally hosted banner images. `data/gardens.json` configures DBGI's five garden groups; the EMI homepage groups those gardens visually while preserving all original Directus project records. Check the route affected by your PR in **both** modes, not just its unit tests. When touching asset paths or Pages staging, verify that each staged `index.html` loads its `assets/js/`, `assets/css/` files and its own banner. The [manual smoke list](docs/manual-checks.md) covers the main routes. A local `file://` preview cannot fetch snapshots. PR checks run Python and Node tests without Directus secrets; the Pages workflow deploys on `main`, daily, or by manual dispatch.

## Directus access and refresh

**Normal contributors need none.** `data/` contains committed public, read-only snapshots. `scripts/build_snapshot.py` needs a token because `Taxa` is not anonymously readable; `Field_Data` can be public, but the sample/taxon export must read **both**. To regenerate collectors, `People` also requires read access (`id,full_name,orcid,inat`); emails are not exported. The other exporters currently accept public collection fields, but a full deployment uses one dedicated read-only token. It must read all rows, projected fields and `aggregate[count]=id` for `Field_Data`, `Taxa`, `People`, `Containers`, `Dried_Samples_Data`, `Extraction_Data`, `Aliquoting_Data`, `MS_Data`, `Instruments`, `Injection_Methods`, and `Curation_Data`. Also allow the *actual* related collection and `id,instrument_model` fields behind `Instruments.instrument_model` (inspect the Directus schema; do not guess its name). The exact projected fields are in the exporter `FIELDS`/`*_FIELDS` constants under `scripts/`. Review permissions and privacy with a maintainer before broadening exported fields.

An authorized maintainer should create an **active, non-admin API user** with a read-only policy and a **static token**, then **save** the user. A login access token is not an equivalent long-lived deployment credential. Check the saved token locally before setting any GitHub secret:

```bash
read -r -s -p 'Read-only Directus token: ' DIRECTUS_TOKEN; printf '\n'
curl -sS -o /dev/null -w 'Authentication: HTTP %{http_code}\n' \
  -H "Authorization: Bearer ${DIRECTUS_TOKEN}" \
  https://emi-collection.unifr.ch/directus/users/me
curl -sS -o /dev/null -w 'Field_Data count: HTTP %{http_code}\n' \
  -H "Authorization: Bearer ${DIRECTUS_TOKEN}" \
  'https://emi-collection.unifr.ch/directus/items/Field_Data?aggregate%5Bcount%5D=id'
```

`/users/me` should return **200**; **401** means the token or account was not authenticated (e.g. unsaved token, wrong instance, inactive user). If authentication works but the count returns **403**, fix read/count permissions; also confirm `Taxa` and other collection projections before a full export. Do not paste a token into a command line, PR, issue, repository file or Actions log. Tokens can be rotated in Directus; an optional `DIRECTUS_INSTANCE` overrides the default **credential-free HTTPS** base URL for local exporters.

For a complete local refresh, **only if authorized**, export the token in your shell and run the exporters in dependency order:

```sh
export DIRECTUS_TOKEN
python3 scripts/build_snapshot.py
python3 scripts/build_collectors.py
python3 scripts/build_garden_progress.py
python3 scripts/build_ms_profile.py
python3 scripts/build_processing.py
python3 scripts/build_inaturalist.py
python3 scripts/build_refresh_manifest.py
unset DIRECTUS_TOKEN
```

`build_collectors.py`, MS and processing exporters depend on the freshly exported `data/samples.json`; the final marker is written **only after all six succeed**. The iNaturalist exporter additionally reads the public iNaturalist API. To update optional LOTUS links after Taxa changes, run `python3 scripts/build_wikidata_taxa.py` separately and review/commit `data/wikidata_taxa.json`; that Wikidata mapping is not refreshed by the daily workflow. Exporters that support `--env-file` may read a **local file outside this repository** instead of an environment token, but `build_inaturalist.py` does not offer this flag. Never move, commit or ship an admin `.env` file. Credentials are ignored by `.gitignore`, not by the Pages site.

**Repository owner deployment:** set repository secret `DIRECTUS_READ_TOKEN` under **Settings → Secrets and variables → Actions**; the DBGI caller `.github/workflows/pages.yml` passes it to the build job of `.github/workflows/publish-site.yml`, not the Pages deployment job. The caller selects `site: dbgi`; the Earth Metabolome caller defaults to unrestricted `site: emi`. Both build variants originate from the same Directus export and JavaScript; only the DBGI *published artifact* is limited to botanical-garden projects. Set **Settings → Pages → Build and deployment → Source: GitHub Actions** and allow the `github-pages` environment. Trigger **Actions → Publish dashboard → Run workflow** on `main`. With the token, all six exporters and `build_refresh_manifest.py` must succeed before staging/deploying. Without it, the workflow warns and publishes scoped committed snapshots **without** a complete-refresh marker; a green deployment alone does not prove new data were pulled. The workflow is scheduled for **08:30 Europe/Zurich daily**, but GitHub can delay or drop scheduled jobs; confirm the site's freshness indicator and the Actions run. The DBGI site URL is <https://www.dbgi.org/directus-ui/>. For the Earth Metabolome organization's separate deployment repository and credential, follow the [Earth deployment guide](docs/earth-metabolome-deployment.md). Do not grant PRs or forks deployment credentials.

## Changelog

For noteworthy changes, add a short, factual bullet under **Unreleased** in [CHANGELOG.md](CHANGELOG.md), grouped under Added, Changed, Fixed or Removed as appropriate. Describe what a user or contributor can now do, not every edited file; link the PR once known. Do **not** invent release dates, versions, Directus counts or success claims. Snapshot timestamp-only refreshes and tiny typo fixes do not need entries. At an actual release, a maintainer moves the Unreleased entries into a version/date section and starts a new empty Unreleased section.

## Assets and publication

The GitHub Pages artifact includes only `index.html`, `LICENSE`, `LICENSING.md`, `assets/` and approved JSON from `data/`—not `scripts/`, tests, docs, `.env` or a Node/Python runtime. The collection uses **MIT for original code/docs, CC0 for DBGI/EMI data, and CC BY 4.0 for credited DBGI website imagery and Font Awesome icons**; see [LICENSING.md](LICENSING.md) for exact scopes and attribution. Keep the original terms and credits for imported assets; external iNaturalist photos are linked, not included. Before adding any portrait or artwork, verify the photographer's and logo/trademark holder's rights, even when the DBGI site has a general CC BY notice.
