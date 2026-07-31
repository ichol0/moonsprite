# MoonSprite Development Rules

## Reusable UI

- Before creating renderer UI, inspect `src/renderer/src/components/ComponentLibrary.tsx` and the component-library section in `src/renderer/src/styles.css`.
- Reuse existing React components and CSS contracts before adding a new primitive or visual variant.
- Use `NumberInput`, `ThemedSelect`, `ColorPicker`, existing button classes, modal structure, panel structure, and segmented controls where applicable.
- Register every new reusable UI component in `COMPONENT_LIBRARY_ENTRIES` and add an interactive preview to `previewRenderers`.
- Keep previews representative of default, selected, disabled, and interactive states where those states exist.
- Verify the in-app library from `Help > Component Library` at a minimum viewport of 1024 x 640.
- Keep UI containers square and use `#2979FF` for the primary selected/action color.
