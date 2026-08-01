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
- `src-tauri/src/platform_paths.rs` 统一管理随应用目录保存的图库、色板、笔刷和工作区目录；迁移用户数据位置时只从这里切换。
- `src-tauri/src/platform_clipboard.rs`、`platform_files.rs` 和 `platform_resources.rs` 分别负责系统剪贴板、二进制文件和资源信息；`lib.rs` 只注册命令并协调窗口生命周期。

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

### 动画扩展边界

当前 `SpriteDocument` 以文档级图层和图层组为核心，还没有时间轴、帧或 cel 数据。后续支持 Aseprite 式动画时，帧、关键帧、帧持续时间和 cel 像素应归入“文档编辑”边界，并通过稳定的 `layerId` 关联到图层；它们不能改变图层组关系和图层栏的排序语义。

图层栏布局只接收图层与图层组的身份、父子关系、折叠状态和显示顺序，不读取像素或帧数据。这样同一图层在不同帧之间切换时，图层树、拖拽目标、插入线和撤销边界都保持稳定；时间轴将来可以作为独立栏目接入，而不需要重写图层栏。
## 本轮架构落地

- `core/shortcuts.ts` 统一管理快捷键默认值、解析、持久化和键盘事件格式化。界面只负责展示与触发，不再复制快捷键规则。
- `core/file-preferences.ts` 统一管理编辑器首选项的默认值、校验、范围限制和持久化。新增设置必须先进入 `EditorPreferences`，再由界面消费。
- `core/storage.ts` 是渲染器本地存储的统一安全边界；`core/workspace-layout-preferences.ts` 负责窗口与工作区布局的校验、旧配置兼容和尺寸限制，`App.tsx` 不直接解析持久化数据。
- `core/document-files.ts` 统一文件名、扩展名、保存路径和工程编解码规则；`store/document-file-service.ts` 编排系统对话框与文件读写，`store/recovery-service.ts` 串行化恢复写入和删除。
- `core/history.ts` 保证撤销栈的内存计数与栈内容同步。撤销或重做失败时，原条目必须保留；视图状态不得进入该历史栈。
- `store/clipboard-service.ts` 封装选区与图层剪贴板的快照、系统图片转换和内部回退。剪贴板是应用级临时状态，不属于任一文档的撤销历史；服务边界必须复制像素数组，避免粘贴或调用方意外改写复制来源。
- `core/canvas-input.ts` 统一画布临时输入状态和可复用手势规则，包括当前拖拽、指针状态、修饰键、缩放级别、轴约束、选区缩放和旋转手柄。`CanvasStage.tsx` 仅编排事件与渲染，后续手势拆分必须复用此处规则。
- `core/canvas-visuals.ts` 统一画布指针、透明棋盘、选区边界预览和预览层的对比色规则；`CanvasStage.tsx` 不再自行决定这些视觉语义。
- `core/animation.ts` 统一单帧兼容、帧持续时间、cel 关联和动画时间轴的校验；工程格式迁移只在 `project-format.ts` 入口发生。
- `core/panel-layout.ts` 是栏目顺序、默认尺寸、最小尺寸、旧布局兼容和移动排序的唯一入口；`WorkspacePanels.tsx` 只负责将布局状态连接到栏目渲染和停靠交互。
- `core/palette-layout.ts` 统一调色板色块尺寸、颜色比较、标记对比色和多选色块排序规则；`PalettePanel` 只负责 DOM 命中、文件操作与 store 编排。
- `core/layer-operations.ts` 统一图层移动、跨组、组排序、建组与解组的结构变更和可撤销历史；`workspace.ts` 只负责调用命令、维护会话和展示被阻止操作的提示。
- `App.tsx` 只在实际进入对应流程时动态加载 `CanvasStage`、`HomeWorkspace` 和 `ComponentLibrary`，避免首页启动路径预先解析编辑器与组件库代码。动态加载模块必须保留明确的加载边界，不得把核心文档状态放进懒加载组件内部。
- `core/project-format.ts` 通过 `PROJECT_SCHEMA_VERSION` 和 `migrateProjectManifest()` 作为工程格式入口。未知版本拒绝打开，不猜测字段；未来版本迁移只增加独立迁移分支。

后续拆分大模块时，优先把纯规则提取到 `core/` 并补测试，再让 `store/` 编排状态，最后由 React 组件接入。禁止把新的持久化 key、格式版本判断或坐标算法直接散落到 `App.tsx`、`CanvasStage.tsx` 或面板组件中。
## 工具设置边界

`core/tool-preferences.ts` 统一管理画笔、油漆桶、程序纹理、魔棒和选区工具设置，包括默认值、旧版本兼容、范围限制和 `localStorage` 存取。`workspace.ts` 只负责把这些设置应用到当前会话，不再负责解释持久化数据。
