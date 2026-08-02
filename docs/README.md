# MoonSprite 文档索引

这里是项目的唯一维护入口。代码与文档冲突时，先确认当前实现和测试，再更新对应契约，禁止让两个互相矛盾的说明长期共存。

## 产品与架构

- [产品行为契约](product/behavior.md)：用户可见能力和稳定规则。
- [架构概览](architecture/overview.md)：模块职责和依赖方向。
- [状态与历史](architecture/state-history.md)：会话、dirty、撤销和视图状态。
- [坐标与渲染](architecture/coordinates-rendering.md)：屏幕、视图、画布和图层坐标。
- [文件格式](file-format.md)：`.moonsprite` v1 容器。

## 交互契约

- [指针与修饰键](interactions/pointer-modifiers.md)
- [选区与变换](interactions/selection-transform.md)
- [笔刷与颜色](interactions/brush-color.md)
- [工作区与停靠](interactions/workspace-docking.md)

## 质量与发布

- [回归矩阵](testing/regression-matrix.md)
- [性能基线](testing/performance-baseline.md)
- [性能更新记录](testing/performance-history.md)
- [发布检查表](release/release-checklist.md)
- [架构决策记录](adr/README.md)

## 更新规则

- 行为变化：更新产品或交互契约。
- 状态、历史、坐标或文件格式变化：更新架构文档并新增 ADR。
- Bug 修复：在回归矩阵中增加自动化场景。
- 性能验证：先按 [性能基线](testing/performance-baseline.md) 判断 P0-P4 影响等级；P0/P1 不跑性能基准，P2 定向验证，P3/P4 才运行完整基准。仅 P2-P4 或实际性能变化需要更新性能记录。
- 用户可见变化：更新根目录 `CHANGELOG.md`。
- 发布：逐项执行发布检查表。

文档应描述当前有效规则，不记录逐日聊天过程。过期但有追溯价值的内容移入 `archive/`。
