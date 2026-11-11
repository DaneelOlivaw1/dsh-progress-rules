# Changelog

Notable changes to `dsh-progress-rules`. Versions are semver.

Distribution: this fork releases as git tags (`v0.3.1`, …). The `dsh-progress-rules` name on the npm
registry belongs to the upstream project, so install the fork with
github:DaneelOlivaw1/dsh-progress-rules#v0.3.1

## 0.3.1 — 2026-11-11 (first tagged release of this fork)

### Fixed

- **Web boot aborted with `1 entry did not activate`.** `dsh-client-modules` names each boot graph
  row after the resolved package name (`dsh-progress-rules`) and only strips a trailing `/client`
  from a registration id, but the browser bundle registered itself as `dsh-progress-rules-client`.
  The row therefore never got a factory, and boot failed with
  `client-modules: could not load "dsh-progress-rules"` (reported twice: once for the combo batch
  that had already executed, once for the single-row fallback URL). The bundle now registers the
  package name.
- **The host half was mounted twice.** The bundle patch declared a second Loader row
  (`progress-rules-client`) resolving to the same package, so `index.mjs` was applied twice:
  two `user:progress-rules` sections and two tool guards. A dual-face package needs one row —
  its `dsh.client` declaration is what produces the browser module.

### Removed

- Leftover standalone client-package files from the earlier layout (`client/index.js`,
  `client/package.json`, `pnpm-workspace.yaml`).

### Changed

- `README.md`: documented the hard gate and the settings page (they were missing from the English
  README), `failOnSilent` / `gateMessage` added to both option tables, and the install section now
  states that `dsh plugin` installs the dependency while the `dsh.profile.bundles` entry is added
  separately (by the Web plugin page or by hand).
- Verified against DSH `0.2.2-rc.1` (previously `0.2.1-rc.2`).

## 0.3.0 — 2026-11-11

### Changed

- The settings page ships inside the plugin package: the package declares `dsh.client` and
  `exports["./client"]`, so the Web profile composes it from the same Loader row.
- The settings form is derived from the `.volatile()` `Config` schema instead of hand-written
  fields; saving writes the row back to the profile's `cordis.patch.yml`.

## 0.2.1 — 2026-11-10

### Added

- Fork of [`Adamaik/dsh-progress-rules`](https://github.com/Adamaik/dsh-progress-rules): hard gate
  (`failOnSilent`, `gateMessage`), Web settings page, and the bundled process-discipline rule set.
