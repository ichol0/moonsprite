# 架构概览

MoonSprite 是单窗口、多文档的 Tauri 2 应用。React 渲染工作台，Zustand 管理编辑会话，Canvas 负责像素视图，Rust 提供受控的 Windows 系统能力。

## 依赖方向

```text
React components
      |
      v
Zustand store ----> core algorithms
      |
      v
platform/tauri-api ----> Tauri commands ----> Windows/file system
```

- `core/` 不依赖 React、DOM 或 Tauri，应使用确定性单元测试覆盖。
- `store/` 编排会话、历史和核心算法，不直接绘制 UI。
- `components/` 读取状态、收集输入并渲染，不重复核心算法。
- `platform/` 封装所有渲染器 IPC，组件不得直接散落调用 Tauri。
- `src-tauri/` 校验所有来自前端的路径和参数，并返回可展示错误。

## 当前高风险模块

- `workspace.ts` 同时承担会话、历史、文件、工具和布局状态。
- `CanvasStage.tsx` 同时承担坐标、绘制、预览和输入状态机。
- `App.tsx` 同时承担菜单、快捷键、弹窗和应用外壳。
- `WorkspacePanels.tsx` 聚合多个业务栏目和停靠交互。
- Rust `lib.rs` 聚合多数系统命令。

后续使用渐进迁移拆分这些模块。每次只迁移一个有测试保护的职责，不进行一次性重写。

## 目标模块边界

- 会话状态：文档列表、当前文档、dirty 和生命周期。
- 文档编辑：像素、图层、选区和调整。
- 工具状态：工具、笔刷、颜色、修饰键与指针意图。
- 视图状态：平移、缩放、旋转、网格和预览。
- 文件服务：打开、保存、导入、导出、恢复和最近记录。
- 工作区 UI：栏目、停靠、悬浮、尺寸和布局持久化。

新增功能必须归入其中一个边界；无法归类时先写 ADR，再决定位置。
