# Contributing

MoonSprite is an original implementation. Do not submit copied Aseprite source code, icons, themes, or other protected assets.

1. Install Node.js 22, pnpm, and the Rust stable toolchain.
2. Run `pnpm install` and `pnpm dev`.
3. Run `pnpm typecheck`, `pnpm test`, `cargo fmt --check --manifest-path src-tauri/Cargo.toml`, and `pnpm build` before opening a change.
4. Keep raster behavior covered by deterministic pixel tests.
5. Preserve the square MoonPixel workstation design and accessible keyboard behavior.
