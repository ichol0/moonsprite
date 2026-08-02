# MoonSprite 开发规则

本文件是所有人工开发者和 AI 代理必须遵守的项目级规则。开始修改前先阅读 [文档索引](docs/README.md) 和 [AI 与开发自动工作流](docs/agent-workflow.md)，再阅读与任务相关的行为契约。

## 修改流程

1. 先确定改动属于产品行为、交互、状态、坐标、文件格式还是平台集成。
2. Bug 修复必须先在 `docs/testing/regression-matrix.md` 登记，并优先补一个能复现问题的失败测试。
3. 修改应限制在相关模块，禁止顺带重构无关代码。
4. 用户可见行为变化必须同步更新对应契约和 `CHANGELOG.md`。
5. 视图移动、缩放、旋转、栏目布局等界面状态不得进入文档撤销历史。
6. 坐标转换必须复用统一几何函数，不得在组件内重复计算旋转、缩放和偏移。
7. 不执行强制推送，不提交生成目录、安装包、用户工程、恢复文件或密钥。
8. 只有用户明确要求时才生成安装包。
9. 性能验证按 `docs/testing/performance-baseline.md` 的 P0-P4 影响等级执行。P0/P1 不运行也不登记性能基准；P2 只运行相关定向场景；P3 完整运行一次；P4 完整运行三次取中位数并做桌面验证。先执行 `pnpm check:performance-scope` 辅助判断；工作树已有其他未提交改动时，在命令后传入本任务文件列表，禁止把无关旧改动混入等级判断。人工可按实际影响上调，但不得无依据下调。
10. 阶段性任务完成时必须同步更新有效文档中的当前状态；架构计划以 `docs/architecture/overview.md` 的“计划状态”和“未完成高风险拆分项”为准，并通过 `pnpm check:maintenance` 校验，禁止完成后继续保留过期阶段措辞。

## 可复用 UI

- 创建渲染器 UI 前，先检查 `src/renderer/src/components/ComponentLibrary.tsx` 和 `src/renderer/src/styles.css` 的组件库区域。
- 优先复用 `NumberInput`、`ThemedSelect`、`ColorPicker`、现有按钮、弹窗、栏目和分段控件。
- 新增可复用组件时，必须加入 `COMPONENT_LIBRARY_ENTRIES` 并在 `previewRenderers` 提供可交互预览。
- 预览应覆盖默认、选中、禁用和交互状态。
- 至少在 1024 x 640 视口通过 `帮助 > 组件库` 检查布局。
- UI 容器保持直角，主要选中和操作颜色统一使用 `#2979FF`。

## 模块边界

- `core/` 保存可独立测试的像素、选区、格式和几何算法，不依赖 React。
- `store/` 管理文档会话与操作，不直接实现视图绘制。
- `components/` 管理展示和输入，不复制核心算法。
- `platform/` 是渲染器访问 Tauri 的唯一边界。
- `src-tauri/` 负责系统文件、窗口、恢复、剪贴板、缩略图和打包集成。
- 不为超大文件增加新的无关职责；新逻辑优先提取到明确模块，并由测试保护。

## 完成检查

```powershell
pnpm typecheck
pnpm test
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
pnpm build
```

根据改动范围运行必要命令。涉及发布时还应执行 `docs/release/release-checklist.md`。
