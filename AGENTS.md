# Repository Guidelines

## Source layout

- Preserve `mnaddon.json` identity and version unless the requested change requires a release.
- Runtime code is in root JavaScript files; root HTML panels use `scripts/`, `styles/`, and `resources/`.
- This repository owns MN KnowledgeBase. The independent card-box addon and sibling plugin implementations belong to separate repositories.
- Do not add credentials, local notebook identifiers, private review reports, build outputs, or machine-specific configuration to the public source.

## Build and verification

- Use Node.js 24 and `npm test` for the explicit offline regression suite.
- Use `npm run pack` for local packaging; `build/payload.json` is the runtime payload contract.
- Packaging verifies ZIP integrity and exact source parity. It never uploads, deploys, installs, or changes the addon version.
- Cross-repository tests require explicit `MNKB_PROJECT_ROOTS` values and are separate from public CI.
- Keep syntax, offline tests, integration tests, browser checks, package checks, and MarginNote device acceptance distinct in reports.

## Configuration boundaries

- Preserve saved user configuration. Missing template, board, or search-root configuration must not select a personal default.
- OCR credentials belong to their configured endpoint. Never embed or inject credentials into source or packaged assets.
- Preserve upstream vendor headers and bundled renderer resources.
