# MoonSprite

MoonSprite 是面向 Windows 的原创源码可见像素画工作台，使用 Tauri 2、React、TypeScript、Zustand 和 Canvas 构建。项目与 Aseprite 无隶属关系，也不使用其源码、品牌或视觉资产。

当前界面渠道标识为 `DEV`；构建系统继续使用合法的内部 SemVer `0.1.0`。

## 当前能力

- 多项目标签、复制视图、首页最近项目、画廊和异常恢复。
- 画笔、橡皮擦、选区、移动、形状、油漆桶、吸管、抓手、缩放和旋转视图工具。
- RGBA 与索引颜色、前景色与背景色、多种调色盘和自定义色板。
- 基础、灰度图、程序纹理和项目内自定义笔刷。
- 图层、嵌套文件夹、可见性、锁定、不透明度、混合模式、合并和拖放排序。
- 框选、套索、魔棒、选区组合、移动、复制、翻转、缩放和旋转变换。
- 工作区、栏目停靠、悬浮窗口、布局实时保存和复位。
- `.moonsprite` 工程读写、Aseprite 工程导入与导出，以及常用图片格式导入导出。
- 系统剪贴板图片复制粘贴、恢复草稿、文件关联和 Windows 缩略图。

详细行为以 [产品行为契约](docs/product/behavior.md) 和 [交互契约](docs/README.md#交互契约) 为准。

## 开发环境

- Node.js 22
- pnpm 11
- Rust stable
- Windows 10/11 与 WebView2 Runtime

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

常用检查：

```powershell
pnpm typecheck
pnpm test
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
pnpm build
```

`pnpm package` 会在 `release/` 生成 NSIS 安装包和便携版。该目录不进入 Git，且只有明确需要交付安装包时才执行打包。

## 项目资源目录

- `gallery/`：运行时画廊工程。
- `brushes/`：用户 PNG 与灰度图笔刷。
- `workspaces/`：工作区布局文件。
- `src-tauri/resources/`：随应用发布的内置资源。

运行时用户目录不会提交到仓库。内置示例工程位于 `src-tauri/resources/示例.moonsprite`。

## 许可

- 当前源码使用 [MoonSprite Source-Available License 1.0](LICENSE)：允许查看、修改、个人编译与源码形式再分发，但未经书面授权不得分发编译后的 MoonSprite。
- Steam 及其他授权渠道的官方二进制使用 [MoonSprite Official Binary EULA](EULA.md)，允许个人与商业创作，按用户席位授权。
- 已经以 MIT License 发布的历史版本继续保留原有权利，见 [LICENSE-MIT](LICENSE-MIT)。
- 第三方字体与依赖遵循各自许可，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 维护入口

- [文档索引](docs/README.md)
- [贡献指南](CONTRIBUTING.md)
- [变更记录](CHANGELOG.md)
- [文件格式](docs/file-format.md)
- [发布检查表](docs/release/release-checklist.md)
