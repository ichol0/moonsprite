# 参与 MoonSprite 开发

MoonSprite 是原创实现。禁止提交复制自 Aseprite 或其他项目的源码、图标、主题和受保护资源。

## 开发流程

1. 从 `main` 创建短期分支，名称使用 `feature/`、`fix/`、`refactor/` 或 `docs/` 前缀。
2. 阅读 `AGENTS.md`、`docs/README.md` 和任务相关契约。
3. 功能先写规格，Bug 先写复现步骤和回归测试。
4. 保持提交主题单一，禁止混入无关格式化或重构。
5. 按 `docs/release/changelog-policy.md` 将本批每个独立变化追加到 `CHANGELOG.md`，不得覆盖既有记录。
6. 完成必要检查后提交 Pull Request。

## 完成标准

- 行为与对应契约一致。
- Bug 有自动化回归测试，像素算法使用确定性数据断言。
- UI 优先复用组件库，并验证默认、选中、禁用和交互状态。
- 没有把视图状态写入文档历史，也没有重复实现坐标换算。
- `pnpm typecheck`、`pnpm test`、Rust 检查和受影响构建通过。
- 功能、修复、交互、性能、重构、依赖、构建和平台变化均已逐项写入 `CHANGELOG.md`。

## 提交格式

使用 Conventional Commits，例如：

```text
fix: keep selection aligned after rotating the view
feat: add project workspace export
docs: define brush alignment behavior
test: cover layer duplicate undo
```

禁止强制推送 `main`。依赖升级应独立提交，并说明升级原因和验证结果。
