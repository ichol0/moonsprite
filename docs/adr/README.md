# 架构决策记录

ADR 用于记录会长期影响实现的决定，避免后续只看到代码而不知道原因。

## 使用方式

文件名格式：`NNNN-short-title.md`。状态使用“提议”“接受”“废弃”或“替代”。

每个 ADR 包含：背景、决定、结果和替代方案。只记录需要长期遵守的架构决定，不记录普通 Bug 修复。

## 当前决策

- [0001：文档历史与视图状态分离](0001-separate-document-and-view-history.md)
- [0002：动画时间轴与静态图层数据分离](0002-animation-timeline-schema.md)
- [0003：当前图层表面与动画 Cel 像素同步](0003-animation-cel-surfaces.md)
- [0004：动画导出与洋葱皮的隔离](0004-animation-export-and-onion-skin.md)
- [0005：项目元数据与缩时快照持久化](0005-project-metadata-and-timelapse.md)
- [0006：自适应调色板槽位](0006-fixed-palette-slots.md)
- [0007：逐单元格可编辑图层蒙版](0007-attached-layer-masks.md)

新增 ADR 时按编号递增；废弃旧决定时保留原文件并指向替代 ADR。
