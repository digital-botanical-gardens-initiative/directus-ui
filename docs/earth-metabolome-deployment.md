# Publish the same explorer on Earth Metabolome

**First deployment: identical application and Directus snapshots on both sites.** This does not yet introduce a five-garden-only DBGI export or EMI-specific branding. The sole source of HTML, JS, CSS, exporters, tests and data-refresh logic remains [`digital-botanical-gardens-initiative/directus-ui`](https://github.com/digital-botanical-gardens-initiative/directus-ui). Its [reusable Pages workflow](../.github/workflows/publish-site.yml) performs the same build for both repositories. No fork, mirror or manual copying of website files is needed.

The DBGI deployment continues at <https://www.dbgi.org/directus-ui/>. Earth Metabolome already hosts its organization Pages site at <https://www.earthmetabolome.org/>; a Pages project repository named `directus-ui` in that organization is the destination for <https://www.earthmetabolome.org/directus-ui/>. Its repository may contain only a README and the following small calling workflow.

## Before creating the Earth repository

1. Merge and publish the DBGI repository changes containing `.github/workflows/publish-site.yml` and its updated `.github/workflows/pages.yml`. The Earth workflow cannot call a source workflow that has not been pushed to `main`. Confirm that the existing DBGI deployment still works.
2. In the `earth-metabolome-initiative` GitHub organization, create a **public**, non-fork repository named **`directus-ui`** with a README and `main` as its default branch. It is the publishing *destination*, not another application source. Do not copy `index.html`, `assets/`, `data/` or `scripts/` into it.
3. Add `.github/workflows/pages.yml` to **that new Earth repository** with the exact contents below. Commit it on `main`.

```yaml
name: Publish EMI sample explorer

on:
  schedule:
    - cron: '30 8 * * *'
      timezone: 'Europe/Zurich'
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  deploy:
    uses: digital-botanical-gardens-initiative/directus-ui/.github/workflows/publish-site.yml@main
    secrets:
      DIRECTUS_READ_TOKEN: ${{ secrets.DIRECTUS_READ_TOKEN }}
```

The call checks out the latest DBGI `main` **into the Earth repository's Actions runner**, refreshes from Directus, and uploads only the staged static site to **Earth's** GitHub Pages. The `deploy` job starts only after the artifact-uploading `build` job completes; the Directus secret is used only by `build`. The Earth repo does not commit generated copies of source or snapshots. Earth can also run the workflow manually immediately after a DBGI source change; otherwise the next scheduled run picks it up. Scheduled GitHub jobs may be delayed or skipped: check the completed run and the dashboard's refresh timestamp, rather than assuming it ran on time. The two sites refresh separately, so their data timestamps can differ even when their source code matches.

## Enable deployment and Directus refresh

4. On the Earth repo, choose **Settings → Pages → Build and deployment → Source: GitHub Actions**. Permit deployment to the `github-pages` environment if the organization's policies require approval. The organization Pages repository supplies the `www.earthmetabolome.org` custom domain; do **not** claim that same custom domain on the project repository itself. If `/directus-ui/` does not resolve after deployment, confirm that the organization Pages site and custom domain are active and that its project sites inherit the domain.
5. On the Earth repo, set **Settings → Secrets and variables → Actions → New repository secret**: name `DIRECTUS_READ_TOKEN`, value a dedicated, saved, **non-admin, read-only static Directus token** with the [documented export permissions](../CONTRIBUTING.md#directus-access-and-refresh). Use a separate token if practical so it can be rotated independently. Do not commit a `.env` file or place the token in the Earth repository's README or workflow YAML. Without this secret the workflow publishes the committed source snapshots and warns; it **does not perform a fresh Directus pull**.
6. Choose **Actions → Publish EMI sample explorer → Run workflow** on `main`. Confirm all six exports and the `Record completed Directus refresh` step succeed, then confirm the deployment step and visit <https://www.earthmetabolome.org/directus-ui/>. Check that sample search, a sample page, styles, the banner, and `data/refresh.json` load; the freshness panel's **Refresh runs** link should open the Earth repo's Actions workflow. Compare DBGI and EMI record counts and snapshot timestamps after each successful refresh; for this first phase they should cover the same projects, though timestamps and changing Directus records may differ.

The Earth organization must permit calling a public reusable workflow from the DBGI repository. If Actions reports that it cannot find or call the workflow, first confirm the DBGI changes have reached `main`, then check the Earth organization's **Actions → General → Actions permissions** and reusable-workflow policy. If GitHub Pages reports a domain conflict, leave the Earth project repo without its own custom domain and verify the organization Pages custom domain separately.

If all six exports and `upload-pages-artifact` succeed but `deploy-pages` reports **“Found 0 artifact(s)”**, check that the shared workflow's `deploy` job depends on `build` and that the source update is on DBGI `main`. GitHub may not expose an artifact immediately after upload. Start a **new workflow run**, not “Re-run failed jobs” on an old run: a rerun can reuse a run ID that already has a `github-pages` artifact.

Later, a **separate** change can introduce EMI branding and make the DBGI artifact include only the five documented gardens. That will require filtering all linked snapshots at build time, not merely hiding other projects in the browser. Do not assume this first, identical deployment already does so.
