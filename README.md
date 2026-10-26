# aiax-validate

Offline-capable validator for [AIAX v0.1](https://github.com/Godman-s/aiax) manifests and their capability sections. AI-assisted, independently authored implementation. It does not sign, transmit payments, or modify the site being checked.

## Install and use

```bash
npm install
npx aiax-validate https://lax.kognai.ai --json
npx aiax-validate https://www.kognai.ai
npx aiax-validate https://fixture.invalid --fixtures ./fixtures --json
```

CLI exit codes: `0` valid with score >= 90 and no errors/warnings; `1` website validation failure; `2` invalid command-line usage. `--json` prints `{url, manifest_url, ok, score, errors, warnings, sections}`. A schema issue includes the source URL, JSON Pointer and a plain-language message naming the field.

`validateSite(url, {fetch?})` is exported from the package root. Inject `fetch` for deterministic, no-network tests.

## Scope

- Searches `/.well-known/aiax.json`, then `/aiax/manifest.json`.
- Validates both documents against the upstream v0.1 draft 2020-12 schemas included in this package.
- Resolves each section URI against the actual manifest URL, fetches it and checks the `section_id` matches its entry-point ID.
- Handles missing/non-JSON sections, missing manifests and schema errors without throwing to CLI consumers.
- `--fixtures <dir>` maps URL paths to files underneath that directory and returns 404 for missing fixture files. It will not read outside the fixture root.
- Score begins at 100, subtracts 10 per validation error and 2 per warning, and clamps to [0,100].

The upstream schema files in this repository were fetched from `Godman-s/aiax` on 2026-10-26. Their protocol version is 0.1 draft; a green score is not a cryptographic audit or security guarantee. This CLI does not send telemetry.

## Acceptance suite

Tests explicitly named A1 through A5 cover two live sites, manifest and section validation, ID mismatch/missing/non-JSON responses, report JSON, usage/exit codes and offline fixture resolution. Synthetic broken examples are provided in `fixtures/` and carry no customer data.

## Publishing status

The repository is the reproducible source of this task submission. The original npm package name `aiax-validate` is already present on npm and is not claimed as owned by this project. This implementation uses the distinct package name `aiax-validate-livastic-vm1`. Publishing to npm still requires an authorized npm publisher session; this environment has no npm login, so a package is not represented as published. The Kognai bounty also requires a signed LAX listing and a PACT after selection; a public repository alone does not qualify for payment.
