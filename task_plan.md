# MoonSprite 0.1.0 Implementation

## Goal
Build the Windows-first pixel editor defined in the approved plan, including dual color modes, multi-document editing, layers, project files, PNG I/O, recovery, tests, and packaging.

## Phases
- [complete] Bootstrap Tauri, React, TypeScript, build tooling, and project metadata.
- [complete] Implement raster/document core, tools, history, formats, and resource policy.
- [complete] Build the MoonPixel workstation UI and multi-document Canvas workflow.
- [complete] Connect restricted Tauri IPC, file operations, recovery, PNG I/O, and packaging.
- [complete] Run tests, visual QA, builds, and document the release.

## Decisions
- Tauri 2 + React + TypeScript + Zustand, with a typed command bridge.
- Original MIT implementation; no Aseprite source or brand assets.
- RGBA uses Uint8ClampedArray; indexed mode uses Uint32 stable palette IDs.
- One Tauri window with multiple document tabs.
- Community integration, animation, .aseprite support, plugins, and clipboard are out of scope.

## Errors Encountered
| Error | Attempt | Resolution |
|---|---:|---|
| Parent `.git` is not a valid repository | 1 | Treat `moonsprite` as a standalone empty project and do not rely on Git history. |
| pnpm blocked `esbuild` install script | 1 | Add a project-scoped allowlist for `esbuild`, then reinstall so Vite can run. |
| `pnpm run` attempted an automatic install without a TTY | 1 | Disable `verify-deps-before-run` and invoke the installed toolchain directly. |
| Electron opened a blank renderer | 1 | Sandboxed preload was emitted as ESM; switch main/preload output back to Electron-compatible CommonJS. |
| electron-builder pnpm scan failed inside sandbox | 1 | Confirmed `pnpm list --prod` works outside sandbox and ran packaging with approved escalation. |
| electron-builder icon conversion exhausted WebAssembly memory | 1 | Removed unused experimental icon from the default `build/icon.png` location; packaging uses the default icon. |
| Combined NSIS/portable packaging hit a network timeout | 1 | Ran each target separately; both independently completed with distinct artifact names. |
