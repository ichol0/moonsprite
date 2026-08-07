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

## 当前维护风险状态

- 计划状态：已完成
- 未完成高风险拆分项：0

五个原高风险入口已完成计划内的分阶段拆分与验证，已从集中式高风险入口降为边界明确的受控维护点：

- `App.tsx` 保留全局命令、模态框和工作区布局编排；文档标签、工具栏、工具属性栏、状态栏、画布主机和编辑器布局外壳已迁入 `components/app/`。
- `CanvasStage.tsx` 保留画布事件编排和工具预览；选区轮廓、视图预览调度与文档合成缓存已迁入独立模块。
- `workspace.ts` 保留 Zustand 公共 API 和命令编排；公开类型、会话构造、工具设置、历史快照与调色板命令已迁入 `workspace-*` 模块。
- `WorkspacePanels.tsx` 仅负责编排停靠栏目，颜色、调色板、图层和预览均为独立组件。
- Rust `lib.rs` 仅保留应用状态、命令注册、setup 和窗口生命周期协调；调色板、工作区、笔刷、图库、恢复和文件对话框分别位于 `platform_*` 模块。

本轮计划中没有未完成的高风险拆分项。仍需长期控制的维护风险集中在 `App.tsx` 的工作区持久化与全局模态框编排、`CanvasStage.tsx` 的指针手势状态机和 `workspace.ts` 的图层/选区命令；这些模块已有边界和测试保护，但未来新增功能时仍不得重新堆积无关职责。后续开发继续按职责迁移，不以一次性重写替代渐进拆分。

## 目标模块边界

- 会话状态：文档列表、当前文档、dirty 和生命周期。
- 文档编辑：像素、图层、选区和调整。
- 工具状态：工具、笔刷、颜色、修饰键与指针意图。
- 视图状态：平移、缩放、旋转、网格和预览。
- 文件服务：打开、保存、导入、导出、恢复和最近记录。
- 工作区 UI：栏目、停靠、悬浮、尺寸和布局持久化。

新增功能必须归入其中一个边界；无法归类时先写 ADR，再决定位置。

### 动画扩展边界

`SpriteDocument` 以文档级图层和图层组为轨道，并通过独立动画时间轴保存帧、帧持续时间和 cel 像素。cel 使用稳定的 `layerId` 与 `frameId` 关联；它们不能改变图层组关系和图层栏排序语义。`RasterLayer` 仅作为当前帧的编辑表面，切帧由 `core/animation.ts` 统一同步，组件不得自行替换像素数组。

图层栏的树形区域只接收图层与图层组的身份、父子关系、折叠状态和显示顺序；同一栏目右侧的动画区域读取帧与 cel 槽位。两部分共享垂直行布局，但图层拖拽目标和插入线不得依赖帧数据；切帧时图层树保持稳定。
## 本轮架构落地

- `core/shortcuts.ts` 统一管理快捷键默认值、解析、持久化和键盘事件格式化。界面只负责展示与触发，不再复制快捷键规则。
- `core/file-preferences.ts` 统一管理编辑器首选项的默认值、校验、范围限制和持久化。新增设置必须先进入 `EditorPreferences`，再由界面消费。
- `locales/` 按语言拆分资源，简体中文目录定义完整翻译键集合；`core/localization.ts` 统一管理可用语言、目录注册、类型化翻译键、简体中文回退和变量插值，`components/I18nProvider.tsx` 只负责把持久化语言连接到 React。未完整翻译和验收的语言不得注册为可用语言。
- `core/storage.ts` 是渲染器本地存储的统一安全边界；`core/workspace-layout-preferences.ts` 负责窗口与工作区布局的校验、旧配置兼容和尺寸限制，`App.tsx` 不直接解析持久化数据。
- `core/document-files.ts` 统一文件名、扩展名、保存路径和工程编解码规则；`store/document-file-service.ts` 编排系统对话框与文件读写，`store/recovery-service.ts` 串行化恢复写入和删除。
- `core/history.ts` 保证撤销栈的内存计数与栈内容同步。撤销或重做失败时，原条目必须保留；视图状态不得进入该历史栈。
- `store/clipboard-service.ts` 封装选区与图层剪贴板的快照、系统图片转换和内部回退。剪贴板是应用级临时状态，不属于任一文档的撤销历史；服务边界必须复制像素数组，避免粘贴或调用方意外改写复制来源。
- `core/canvas-input.ts` 统一画布临时输入状态和可复用手势规则，包括当前拖拽、指针状态、修饰键、缩放级别、轴约束、选区缩放和旋转手柄。`CanvasStage.tsx` 仅编排事件与渲染，后续手势拆分必须复用此处规则。
- `core/canvas-visuals.ts` 统一画布指针、透明棋盘、选区边界预览和预览层的对比色规则；`CanvasStage.tsx` 不再自行决定这些视觉语义。
- `core/animation.ts` 统一单帧兼容、帧持续时间、cel 独立表面、切帧同步、图层轨道对账和播放推进；像素历史通过 `frameId` 定位原 cel，工程格式迁移只在 `project-format.ts` 入口发生。
- `core/panel-layout.ts` 是栏目顺序、默认尺寸、最小尺寸、旧布局兼容和移动排序的唯一入口；`WorkspacePanels.tsx` 只负责将布局状态连接到栏目渲染和停靠交互。
- `core/panel-render-keys.ts` 定义颜色、色板、图层和预览栏目的最小刷新边界。图层栏目仅在图层结构、活动帧、帧参数或播放状态变化时刷新；普通像素编辑、视图平移、缩放和旋转不重建整张帧网格。栏目不得重新订阅整份 Zustand store。
- `core/palette-layout.ts` 统一调色板色块尺寸、颜色比较、标记对比色和多选色块排序规则；`PalettePanel` 只负责 DOM 命中、文件操作与 store 编排。
- `core/layer-operations.ts` 统一图层移动、跨组、组排序、建组与解组的结构变更和可撤销历史；`workspace.ts` 只负责调用命令、维护会话和展示被阻止操作的提示。
- `App.tsx` 只在实际进入对应流程时动态加载 `CanvasStage`、`HomeWorkspace` 和 `ComponentLibrary`，避免首页启动路径预先解析编辑器与组件库代码。动态加载模块必须保留明确的加载边界，不得把核心文档状态放进懒加载组件内部。
- `core/project-format.ts` 通过 `PROJECT_SCHEMA_VERSION` 和 `migrateProjectManifest()` 作为工程格式入口。未知版本拒绝打开，不猜测字段；未来版本迁移只增加独立迁移分支。
- `components/app/useBrushLibrary.ts` 负责编排程序笔刷、项目笔刷和本地笔刷的加载、保存、删除与当前会话同步；`EditorToolOptions.tsx` 消费整理后的笔刷集合和命令。
- `core/app-render-keys.ts` 定义菜单、标签、工具栏、工具属性栏、状态栏和应用协调器的最小刷新签名。签名不得包含像素数组；动画接入后按帧身份和可见 UI 字段扩展，不得序列化 cel 像素。
- `components/app/DocumentTabs.tsx`、`EditorToolRail.tsx`、`EditorToolOptions.tsx` 和 `EditorStatusBar.tsx` 各自订阅领域签名并拥有自身弹层状态；`EditorCanvasHost.tsx` 是高频会话更新入口，`EditorWorkspaceShell.tsx` 只编排停靠布局。
- `components/canvas-selection-renderer.ts` 负责选区屏幕几何、边界路径缓存和抓手绘制；`components/useCanvasViewPreview.ts` 负责平移、缩放预览及提交；`components/canvas-composite-cache.ts` 负责整图/分块合成缓存和局部失效。
- `store/workspace-session.ts` 管理会话构造和工具设置持久化，`store/workspace-history.ts` 管理文档与图层历史快照，`store/workspace-palette.ts` 管理调色板选择、排序和历史命令。
- Rust 平台命令按领域拆分为 `platform_palette.rs`、`platform_workspaces.rs`、`platform_brushes.rs`、`platform_gallery.rs`、`platform_recovery.rs` 和 `platform_dialogs.rs`；新增系统命令必须进入对应领域模块。

后续拆分大模块时，优先把纯规则提取到 `core/` 并补测试，再让 `store/` 编排状态，最后由 React 组件接入。禁止把新的持久化 key、格式版本判断或坐标算法直接散落到 `App.tsx`、`CanvasStage.tsx` 或面板组件中。

React 性能探针通过 `?moonsprite-perf=1` 启用，普通软件启动不执行 Profiler 测量。应用协调器不响应像素、平移和旋转等高频变化；画布主机、作品预览及实际变化的 UI 领域仍独立更新。后续优化应以区域探针确认的新热点为依据，不得以跳过必要状态更新换取指标。
## 工具设置边界

`core/tool-preferences.ts` 统一管理画笔、油漆桶、程序纹理、魔棒和选区工具设置，包括默认值、旧版本兼容、范围限制和 `localStorage` 存取。`workspace.ts` 只负责把这些设置应用到当前会话，不再负责解释持久化数据。
