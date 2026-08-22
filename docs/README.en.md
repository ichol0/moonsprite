# MoonSprite Documentation Index

[中文](README.md) | English

> Human-facing English mirror. AI agents use `docs/README.md` and Chinese contracts as their sole routine documentation context. Do not load this index during ordinary development.

This index is maintained for English-speaking human readers. English mirrors are synchronized only for explicitly requested translation work, bilingual audits, or the files actually changed during a release cycle.

## Product and Architecture

- [Product behavior contract](product/behavior.en.md): user-visible capabilities and stable rules.
- [UI design system](ui-design-system.en.md): colors, typography, spacing, control density, pixel icons, and component reuse.
- [Architecture overview](architecture/overview.en.md): module responsibilities and dependency direction.
- [State and history](architecture/state-history.en.md): sessions, dirty state, undo, and view state.
- [Coordinates and rendering](architecture/coordinates-rendering.en.md): screen, view, canvas, and layer coordinates.
- [Localization architecture](architecture/localization.en.md): language resources, fallback, persistence, and adding-language gates.
- [File format](file-format.en.md): the `.moonsprite` v16 container.

## Interaction Contracts

- [Pointer and modifier keys](interactions/pointer-modifiers.en.md)
- [Selections and transforms](interactions/selection-transform.en.md)
- [Brushes and color](interactions/brush-color.en.md)
- [Workspace and docking](interactions/workspace-docking.en.md)

## Script Development

- [Lua scripting and MSE API](scripting/README.en.md)
- See the [extension package ADR](adr/0020-extension-package-format.en.md) for `.msext` package format and installation behavior.

## Quality and Release

- [Regression matrix](testing/regression-matrix.en.md)
- [Performance baseline](testing/performance-baseline.en.md)
- [Performance history](testing/performance-history.md) (canonical audit ledger, Chinese)
- [Complete changelog policy](release/changelog-policy.en.md)
- [Development version cycle](release/development-cycle.md) (current maintainer state, Chinese)
- [Historical changelog archive](changelog/README.md) (Chinese release archive)
- [Release checklist](release/release-checklist.en.md)
- [Architecture decision records](adr/README.en.md)

## Update Rules

- Behavior change: update the product or interaction contract.
- State, history, coordinates, or file-format change: update the architecture documentation and add an ADR.
- Bug fix: recurring or hard-to-detect bugs, shared algorithms, and coordinate, undo, file-data, or platform-security bugs require a regression scenario. Users validate ordinary visual issues.
- Performance validation: ordinary requests do not run benchmarks. Every `dev.X` or formal release performs at least one P3 audit. Strengthen and record validation for dedicated performance work, actual regressions, or explicit user requests according to the [performance baseline](testing/performance-baseline.en.md).
- Software changes: at `dev.X` release time, update the root `CHANGELOG.md` from the complete diff after the cycle baseline. Keep a separate entry for every independently describable effective change.
- Language synchronization: routine development updates Chinese documentation only. During release, synchronize only English mirrors corresponding to files actually changed in the cycle. Translation, English-document maintenance, and bilingual audits are explicit tasks, not routine side work.
- Release: complete every item in the release checklist.

Documentation describes current effective rules, not a day-by-day chat history. Move obsolete material with historical value into `archive/`.
