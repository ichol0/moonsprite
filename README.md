# MoonSprite

MoonSprite is an original, open-source pixel art workstation for Windows. It is inspired by the workflow of established pixel editors, but it does not copy Aseprite source code, branding, icons, or themes.

## Current 0.1.0 scope

- Tauri 2 + React + TypeScript desktop app, using the Windows WebView2 runtime.
- Multiple document tabs in one window.
- Pencil, eraser, flood fill, eyedropper, rectangular selection, selection move, hand pan, and zoom.
- RGBA and indexed color documents with stable palette IDs.
- Layers with visibility, opacity, reorder, duplicate, rename, and delete.
- Versioned `.moonsprite` project files, PNG import, and indexed/RGBA PNG export.
- Automatic recovery drafts and three-way unsaved-close prompts.
- Chinese-first MoonPixel workstation UI with square surfaces and `#2979FF` interaction accents.
- A home screen gallery that reads `.moonsprite` projects from the `gallery` folder beside the executable and shows their embedded previews.
- Home sections for recently opened projects and developer-managed news, with independent local pinning for gallery and recent items.
- Local PNG brush library beside the running executable. Grayscale brush images use white as full coverage, black as no paint, and gray as a one-color pixel-density mask.

Animation, `.aseprite` compatibility, community publishing, plugins, and clipboard operations are intentionally outside 0.1.0.

## Development

Requirements: Node.js 22, pnpm 11, and the Rust stable toolchain. Windows 11 includes WebView2; Windows 10 systems must have the [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) installed.

```powershell
pnpm install
pnpm dev
```

Checks:

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm package
```

`pnpm package` produces two Windows artifacts in `release/`: `MoonSprite-Setup-0.1.0-x64.exe` is the NSIS installer and `MoonSprite-Portable-0.1.0-x64.exe` runs directly without installation. Both are kept below 100 MiB; the current Tauri artifacts are substantially smaller because WebView2 is supplied by Windows rather than bundled with the application. Windows may show an unknown-publisher warning because release signing is not part of 0.1.0.

The Windows installer registers a native `.moonsprite` thumbnail provider that reads each project's embedded `preview.png`. Portable builds include `moonsprite_thumbnail.dll` plus `register-thumbnail-provider.ps1` and `unregister-thumbnail-provider.ps1` for optional current-user registration.

## Home gallery

On first launch MoonSprite creates a `gallery` folder beside the running executable. Put `.moonsprite` files directly in that folder, then return to the home screen and use the refresh button. Each project uses the `preview.png` stored inside the project ZIP, so browsing the gallery does not require decoding all layer data. The `图库文件夹` action opens the exact folder used by the running copy of MoonSprite.


## Brush library

MoonSprite creates a `brushes` folder beside the running executable the first time the brush picker is opened. Put PNG pixel brushes or grayscale texture images in that folder, then use the pencil tool's brush button and choose `刷新`. A grayscale source acts as a one-color density map: white paints fully, black leaves the canvas untouched, and gray uses ordered pixel dithering while always retaining the current color. The brush library also includes deterministic procedural noise, cloud, cell, and fiber textures. The normal brush-size control scales the image with nearest-neighbor pixels.

## Project format

`.moonsprite` is a ZIP container with a versioned `manifest.json`, one binary RGBA or IDX32 layer file per layer, and a flattened preview PNG. The format is designed for MoonSprite and is not intended to claim compatibility with Aseprite files.

The project is MIT licensed. See [LICENSE](LICENSE) and [CONTRIBUTING.md](CONTRIBUTING.md).
