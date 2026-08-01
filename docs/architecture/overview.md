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
## 本轮架构落地

- `core/shortcuts.ts` 统一管理快捷键默认值、解析、持久化和键盘事件格式化。界面只负责展示与触发，不再复制快捷键规则。
- `core/file-preferences.ts` 统一管理编辑器首选项的默认值、校验、范围限制和持久化。新增设置必须先进入 `EditorPreferences`，再由界面消费。
- `core/history.ts` 保证撤销栈的内存计数与栈内容同步。撤销或重做失败时，原条目必须保留；视图状态不得进入该历史栈。
- `core/project-format.ts` 通过 `PROJECT_SCHEMA_VERSION` 和 `migrateProjectManifest()` 作为工程格式入口。未知版本拒绝打开，不猜测字段；未来版本迁移只增加独立迁移分支。

后续拆分大模块时，优先把纯规则提取到 `core/` 并补测试，再让 `store/` 编排状态，最后由 React 组件接入。禁止把新的持久化 key、格式版本判断或坐标算法直接散落到 `App.tsx`、`CanvasStage.tsx` 或面板组件中。
## 工具设置边界

`core/tool-preferences.ts` 统一管理画笔、油漆桶、程序纹理、魔棒和选区工具设置，包括默认值、旧版本兼容、范围限制和 `localStorage` 存取。`workspace.ts` 只负责把这些设置应用到当前会话，不再负责解释持久化数据。
