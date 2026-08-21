# 高风险回归矩阵

本文件只保存长期值得维护的高风险契约，不记录每次 Debug 的具体现象。精简前的 363 条场景保存在 [DEV.3 Debug 回归明细归档](../archive/regression-matrix-dev3-debug-detail.md)，普通开发不得加载该归档。

## 收录标准

场景至少满足一项才进入本矩阵：

- 可能造成工程、用户文件或恢复数据损坏。
- 涉及格式兼容、撤销、坐标、跨文档状态或平台安全，难以仅靠人工验收发现。
- 同类问题至少复发两次，并且已有稳定自动化测试。
- 代表跨模块长期不变量，未来扩展很容易破坏。

纯布局、颜色、边框、图标、指针样式、弹窗尺寸、文案和一次性显隐问题不进入矩阵，由现有组件测试和用户验收负责。新 Bug 优先扩展已有契约与测试；只有出现新的高风险不变量时才新增一行。

## 文件与数据

| 契约 | 必须保持的结果 | 自动化保护 |
| --- | --- | --- |
| 工程格式迁移与未知版本 | v1/v2 工程迁移到当前结构；未知 schema、无效帧和无效 cel 明确拒绝，不猜测解析 | `project-format.test.ts`、`animation.test.ts` |
| 动画工程序列化 | 帧、时长、cel 像素、连接关系和图层轨道保存重开后保持一致，连接表面不重复写入 | `project-format.test.ts`、`animation.test.ts` |
| 原子保存与并发保存 | 保存失败不损坏原文件；并发保存按顺序完成，dirty 只反映最后已持久化状态 | `workspace.test.ts`、`document-files.test.ts`、Rust 文件测试 |
| Aseprite 导入兼容 | 合法单帧/多帧像素、图层和时长正确导入；截断、未知或越界数据明确失败 | `aseprite.test.ts` |
| 图片与 GIF 编码 | PNG 等静态格式保持尺寸与透明度；GIF 帧顺序、时长、缩放和往返方向生成确定字节结果，跨越 LZW 编码位宽边界后仍可逐帧解码为精确像素 | `png.test.ts`、`gif.test.ts`、`raster-image.test.ts` |
| 输入资源上限 | 零尺寸、溢出、超大图片、异常工程和剪贴板数据在分配大内存或调用系统接口前被拒绝 | `resource-policy.test.ts`、`NewDocumentDialog.test.tsx`、Rust 剪贴板测试 |
| 恢复写入与放弃 | 恢复保存串行执行；用户放弃后等待在途写入结束并删除，晚到写入不得重新创建草稿 | `recovery-service.test.ts`、`workspace.test.ts`、Rust 恢复测试 |
| 恢复能力降级 | 恢复目录或会话标记不可写时只记录警告，不阻止主窗口和编辑器启动 | Rust `platform_recovery` 测试 |
| 文件拖放去重 | Windows 路径与 `file://` 路径统一规范化；HTML、Webview、Window 与 Rust 重复事件只打开一次并可重新订阅 | `document-drop.test.ts`、`document-drop-events.test.ts`、`document-drop-service.test.ts` |
| 笔刷库文件边界 | 拖到笔刷库的图片不得作为文档打开；RGBA 和半透明像素往返保存保持，宽高超过 `256px` 在写盘前拒绝；`Ctrl+B` 只写全局库且不污染工程 dirty | `brushes.test.ts`、`workspace-session.test.ts`、`document-drop-service.test.ts`、`workspace.test.ts` |
| 最近文件清理边界 | 路径确实不存在时移除最近记录；文件仍存在但解析失败时保留，不能把读取错误当成用户删除 | `HomeWorkspace.test.tsx`、Rust `platform_files` 测试 |
| 剪贴板快照隔离 | 系统剪贴板不可读时回退内部快照；粘贴、变换和跨文档操作不得改写复制来源像素 | `clipboard-service.test.ts`、`workspace.test.ts` |
| Tileset 槽位兼容 | 空槽布局保存重开后保持；旧 v13 紧凑布局可读取；重复、缺失或越界槽位明确拒绝，槽位移动不改变瓦片像素和稳定引用 | `project-format.test.ts`、`tilemap.test.ts`、`workspace-tilemap.test.ts` |
| Tilemap 共享 Tileset | 新建 Tilemap 图层默认新建 Tileset，也可复用已有 Tilemap Tileset；尺寸跟随、删除引用不误删资源、保存重开后共享 ID 保持 | `project-format.test.ts`、`workspace-tilemap.test.ts` |
| 图层转换为 Tilemap | 普通或背景图层按画布网格裁切全部帧，相同瓦片去重、边缘补透明；转换、重命名、背景身份、Tileset 与会话选择通过同一个 Undo/Redo 完整恢复 | `tilemap.test.ts`、`workspace-tilemap.test.ts`、`LayersPanel.test.tsx` |
| 栅格选区粘贴到自由瓦片 | 未选实例时普通画布选区按原坐标裁切并创建源、Tileset 与实例；已选实例时只编辑其共享源并同步全部同源实例；Undo/Redo 不遗留资源，普通动画 cel 仍拒绝粘贴到自由瓦片或实例时间轴 | `free-tile.test.ts`、`workspace-tilemap.test.ts`、`command-context.test.ts` |
| 自由瓦片实例选区变换 | 新建选区只落在当前实例；普通及旋转/镜像实例按显示朝向移动、缩放、旋转和倾斜，移动预览不落后一帧，结果逆向写回共享源并实时刷新同源实例；其他实例不出现选区覆盖层，源像素、选区和轴心通过一次 Undo/Redo 同步恢复 | `free-tile.test.ts`、`workspace-tilemap.test.ts` |
| 自由瓦片实例属性与行手势 | 非正方形实例旋转、镜像后的边界、命中、合成和源同步正确；属性变换保持显示左上角，保存重开与 Undo/Redo 保留状态；实例眼睛/锁支持图层一致的 `Alt` 全部操作和按住跨行操作；多选实例的属性与删除各自只产生一个可完整撤销的历史步骤 | `free-tile.test.ts`、`workspace-tilemap.test.ts`、`project-format.test.ts`、`LayersPanel.test.tsx` |
| 偏好与语言回退 | 损坏、未知或旧版偏好安全回退；切换语言不翻译工程名、图层名和用户输入 | `file-preferences.test.ts`、`localization.test.ts` |
| 原生标题栏拖动安全 | 单击标题栏只激活窗口；只有主键仍处于物理按下状态且指针超过拖动阈值时才进入系统拖动，异步请求到达时若已松键必须拒绝，双击最大化和标题按钮保持可用；最大化或还原完成后先重置一次原生指针，并在下一次无按键的标题栏客户端移动时再次清除 Windows 顶部边框遗留的上下缩放指针 | `AppWindowTitleBar.test.tsx`、`app-window.test.ts`、Rust `cargo check` |

## 历史与会话

| 契约 | 必须保持的结果 | 自动化保护 |
| --- | --- | --- |
| 空历史操作 | 无历史时 Undo/Redo 无副作用，不改变 dirty 或视图状态 | `history.test.ts`、`workspace.test.ts` |
| 单动作单历史 | 图层批处理、选区变换、调整、画布尺寸和动画编辑每个用户动作只产生一个可完整恢复的历史条目 | `workspace.test.ts`、`layer-operations.test.ts`、`CanvasResizeDialog.test.tsx` |
| 视图状态隔离 | 平移、缩放、旋转、镜像、栏目布局、播放位置和工具切换不进入文档历史，不改变 dirty | `view-preview-lifecycle.test.ts`、`workspace.test.ts`、`animation.test.ts` |
| 临时预览隔离 | 画布尺寸、视图和颜色调整预览可取消或内部撤销，确认前不污染文档历史 | `CanvasResizeDialog.test.tsx`、`AdjustmentDialog.test.tsx`、`adjustment-preview-lifecycle.test.ts` |
| 进行中路径历史 | 自由形状、多边形形状与两种套索在完成前逐点 Undo/Redo；撤销最后一点后退出手势并继续文档历史，完成后仍只提交一次 | `canvas-input.test.ts`、`workspace.test.ts` |
| 历史失败恢复 | 撤销或重做执行失败时原条目和内存计数保持，可在修复条件后重试 | `history.test.ts` |
| 跨帧历史定位 | 在其他帧执行 Undo/Redo 时仍修改原操作所属 frame/cel，不误写当前帧 | `animation.test.ts`、`workspace.test.ts` |
| 跨文档图层剪贴板 | 复制图层和组保留层级、顺序、偏移和属性；目标粘贴独立像素并作为一次历史 | `workspace.test.ts`、`layer-operations.test.ts` |
| 调整与后续操作顺序 | 调整确认后再编辑像素或选区时，两项历史严格分离并按原顺序 Undo/Redo | `workspace.test.ts`、`history.test.ts` |

## 坐标与像素编辑

| 契约 | 必须保持的结果 | 自动化保护 |
| --- | --- | --- |
| 视图逆变换 | 旋转、水平/垂直镜像和非整数缩放后，绘制、吸色、选区与预览命中同一文档像素 | `view-geometry.test.ts`、`canvas-input.test.ts` |
| 指针锚点缩放 | 主画布和预览栏缩放前后保持指针下的文档位置，不因旋转或镜像回弹 | `view-geometry.test.ts`、`preview-geometry.test.ts` |
| 视口尺寸重绘 | 分栏和浮窗改变宽高时，旧 Canvas 位图在下一次重绘前保持原像素比例，不被 CSS 横向或纵向拉伸 | `canvas-display-size.test.ts` |
| 选区命中对称性 | 八个手柄、边缘移动、旋转和倾斜使用连续文档坐标，左右上下命中无固定偏移或空洞 | `canvas-input.test.ts`、`canvas-visuals.test.ts` |
| 套索与组合边界 | 套索闭合不丢右边或下边像素；新建、加选、减选、交集和比例修饰键使用统一规则 | `tools.test.ts`、`selection.test.ts`、`canvas-input.test.ts` |
| 画布外选区内容 | 浮动内容移出画布再移回时像素完整保留，确认时才按文档边界写入 | `tools.test.ts`、`workspace.test.ts` |
| 浮动选区镜像缓存 | 粘贴或移动后反复水平/垂直镜像再移动，像素、掩码与快速路径缓存同步，不恢复旧方向、生成重复像素或留下无法撤销的画布内容 | `tools.test.ts`、`workspace.test.ts` |
| 平铺选区移动 | 任一可见平铺副本都能命中原选区；拖动跨越副本接缝或最外侧副本时按连续文档坐标逐像素移动，内部坐标跨过画布周期后实时预览仍不反向跳变、停住或裁掉接缝内容；确认后越界像素与选区按启用轴折回原画布，Undo/Redo 保持一致 | `canvas-input.test.ts`、`tilemap.test.ts`、`canvas-composite-cache.test.ts`、`tools.test.ts`、`workspace.test.ts` |
| 平铺工具预览 | 铅笔、橡皮擦、直线、形状、渐变、喷枪和瓦片绘制预览同步出现在全部可见平铺副本；大笔刷越界轮廓保持连续几何，采样坐标按启用轴折回，边缘不裁断、不错误重组且不复制鼠标指针 | `tilemap.test.ts` |
| 跨轴缩放翻转 | 选区缩放越过对侧边界时切换对应镜像，预览与提交一致并只产生一次撤销 | `canvas-input.test.ts`、`tools.test.ts`、`selection.test.ts` |
| 多帧画布尺寸 | 调整画布尺寸时所有 frame/cel 使用同一偏移；扩大、裁切、Undo/Redo 后保持相对位置 | `animation.test.ts`、`workspace.test.ts`、`document.test.ts` |
| 调整预览基线 | 调整期间移动、变换或加减选时始终从未调整基线计算，不闪回、不重复叠加、不污染范围外像素；链接 Cel 预览不提前写入共享源，确认和 Undo/Redo 保持链接语义 | `AdjustmentDialog.test.tsx`、`adjustment-preview-lifecycle.test.ts`、`adjustments.test.ts`、`workspace.test.ts` |
| 对称变换闭包 | 多轴绘制、填充和选区计算闭包并去重，轴线像素只写一次，结果合并为一次历史 | `symmetry.test.ts`、`tools.test.ts`、`selection.test.ts` |
| 对称轴首次定位 | 每个工程中的每种对称轴首次启用时使用当前画布中心；同轴重复开关不跳动，不同工程的首次使用状态互不串联 | `workspace.test.ts` |
| 洋葱皮合成 | 相邻帧按完整可见图层合成，当前帧内容和多图层遮挡不改变应显示的洋葱皮结果 | `onion-skin.test.ts` |

## 动画与图层结构

| 契约 | 必须保持的结果 | 自动化保护 |
| --- | --- | --- |
| 时间轴规范化 | 单帧文档建立合法首帧和 cel；切帧同步当前编辑表面，空 cel 不依赖 UI 渲染补建 | `animation.test.ts`、`workspace.test.ts` |
| 帧结构操作 | 新增、复制、删除、排序帧同步维护全部图层 cel 和帧时长，并可一次撤销恢复 | `animation.test.ts`、`workspace.test.ts` |
| cel 连接生命周期 | 连接、断开、清空、删除和粘贴正确维护共享表面；共享编辑同步，整组 Undo/Redo 恢复关系与像素 | `animation.test.ts`、`workspace.test.ts` |
| cel 批量剪贴板 | 多选 cel 按第一格锚点和相对行列复制粘贴，必要时扩展帧，整个操作只产生一次历史 | `workspace.test.ts`、`LayersPanel.test.tsx` |
| 动画图层复制 | 复制图层或组时包含全部 frame/cel、空帧状态和属性，不只复制当前帧 | `workspace.test.ts`、`layer-operations.test.ts` |
| 播放时钟与状态 | 图层栏和预览栏共享单一时钟；帧时长、倍率、循环和停止回退确定，播放不改变 dirty | `useAnimationPlaybackClock.test.tsx`、`animation.test.ts` |
| 嵌套图层结构 | 移动、复制、建组、解组和删除保持树顺序与父子关系，拒绝循环父级，批量操作不重复处理后代 | `layer-operations.test.ts`、`layer-panel-layout.test.ts`、`workspace.test.ts` |
| 锁定传播 | 锁定组及其后代不得修改像素、属性或结构；解锁和历史恢复不丢显式锁定状态 | `layer-operations.test.ts`、`workspace.test.ts` |
| 图层合并结果 | 不同颜色模式、透明度和混合模式合并后的像素确定，合并及 Undo/Redo 保持图层顺序和选择 | `layer-merge.test.ts`、`workspace.test.ts` |

## 平台与发布

| 契约 | 必须保持的结果 | 自动化保护 |
| --- | --- | --- |
| 关闭协调竞态 | 连续关闭、取消和超时同一时刻只处理一个确认；取消后的旧超时不得退出应用 | Rust `close_coordinator` 测试 |
| 原生文件对话框 | 语言、筛选器、扩展名和实际编码格式一致；取消不创建文件或错误进度状态 | Rust `platform_dialogs` 测试、`document-files.test.ts` |
| 文件关联启动 | 从 `.moonsprite` 关联或启动参数打开时只创建一个会话并直接进入编辑器 | `test:tauri`、`test:desktop` 发布门禁 |
| 版本一致性 | package、Cargo、Tauri 和当前应用标识一致；最近已打包版本必须有归档，发布时必须切换到当前目标 | `version-contract.test.mjs`、`pnpm check:version -- --release` |
| 安装与缩略图集成 | 安装、首次启动、文件图标、缩略图注册/卸载和用户文件保留符合发布清单 | `docs/release/release-checklist.md` 发布门禁 |

## 维护规则

- 修改高风险逻辑时先查找对应契约，优先扩展该行引用的测试。
- 新场景没有自动化保护时，只在确属数据、兼容或平台安全缺口时标为“发布门禁”；普通 UI 不得以“待补”形式进入矩阵。
- 每次 `DEV.N` 发布审计重复和过时契约；合并语义，不按 Debug 次数膨胀行数。
- 性能回归只记录在 `performance-baseline.md` 和 `performance-history.md`，不混入本矩阵。
