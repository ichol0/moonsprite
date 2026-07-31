import { copyFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.cwd()
const releaseDirectory = join(root, 'release')
const targetDirectory = join(root, 'src-tauri', 'target', 'release')

await mkdir(releaseDirectory, { recursive: true })
await copyFile(
  join(targetDirectory, 'bundle', 'nsis', 'MoonSprite_0.1.0_x64-setup.exe'),
  join(releaseDirectory, 'MoonSprite-Setup-0.1.0-x64.exe')
)
await copyFile(
  join(targetDirectory, 'moonsprite.exe'),
  join(releaseDirectory, 'MoonSprite-Portable-0.1.0-x64.exe')
)
await copyFile(
  join(root, 'src-tauri', 'thumbnail-provider', 'target', 'release', 'moonsprite_thumbnail.dll'),
  join(releaseDirectory, 'moonsprite_thumbnail.dll')
)
await copyFile(
  join(root, 'src-tauri', 'resources', 'moonsprite-file.ico'),
  join(releaseDirectory, 'moonsprite-file.ico')
)
await copyFile(
  join(root, 'scripts', 'register-thumbnail-provider.ps1'),
  join(releaseDirectory, 'register-thumbnail-provider.ps1')
)
await copyFile(
  join(root, 'scripts', 'unregister-thumbnail-provider.ps1'),
  join(releaseDirectory, 'unregister-thumbnail-provider.ps1')
)
