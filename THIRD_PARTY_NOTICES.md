# Third-party notices

This plugin is a port of [ZITEXT Editor](https://github.com/zitrino-oss/zitext-editor)
by Zitrino, licensed under the **Apache License 2.0**. The upstream `LICENSE`
and `NOTICE` are included verbatim in this repository and in every `.oplg`
release package. The pinned upstream commit is recorded in `upstream.lock.json`.

## What is reused

- `upstream/src/` and `upstream/public/` — an unmodified snapshot of the upstream
  React/TypeScript frontend at the pinned commit. All port-specific changes live
  in `shell/` and are layered onto the build tree by `scripts/tree.mjs`.
- Self-hosted fonts shipped under `upstream/public/fonts/` keep their own
  licenses (SIL Open Font License 1.1 and the Ubuntu Font Licence). Their
  license texts are in `upstream/public/fonts/licenses/` and are copied into
  `dist/fonts/licenses/`.

## Runtime dependencies

| Package | License |
| --- | --- |
| React / React DOM | MIT |
| Monaco Editor / @monaco-editor/react | MIT |
| marked | MIT |
| dompurify | Apache-2.0 / MPL-2.0 |
| github-markdown-css | MIT |
| jsonc-parser | MIT |
| yaml | ISC |
| Vite / @vitejs/plugin-react / TypeScript / Vitest / jsdom (build only) | MIT / Apache-2.0 |

The plugin contains **no Tauri runtime, no Rust backend binary and no network
calls**: filesystem access, dialogs, clipboard and external links all go through
the OTools host bridge (`window.otools`), implemented in `shell/shim/`.
