# High-Risk Regression Matrix

[中文](regression-matrix.md) | English

This file preserves only high-risk contracts worth maintaining over the long term. It does not record the details of every debugging incident. The 363 scenarios that existed before consolidation are preserved in the [DEV.3 debugging regression archive](../archive/regression-matrix-dev3-debug-detail.md), which ordinary development must not load.

## Inclusion Criteria

A scenario enters this matrix only when it meets at least one condition:

- It could corrupt a project, user file, or recovery data.
- It involves format compatibility, undo, coordinates, cross-document state, or platform security and is difficult to catch through manual acceptance alone.
- The same class of problem has recurred at least twice and already has stable automated coverage.
- It represents a long-lived cross-module invariant that future extensions can easily break.

Pure layout, color, border, icon, pointer style, dialog size, wording, and one-off visibility issues do not enter this matrix. Existing component tests and user acceptance cover them. Prefer extending an existing contract and test for a new bug; add a row only when a new high-risk invariant appears.

## Files and Data

| Contract | Required result | Automated protection |
| --- | --- | --- |
| Project-format migration and unknown versions | v1/v2 projects migrate to the current structure; unknown schemas, invalid frames, and invalid cels are rejected explicitly rather than guessed | `project-format.test.ts`, `animation.test.ts` |
| Animation project serialization | Frames, durations, cel pixels, links, and layer tracks remain identical after save and reopen; linked surfaces are not written repeatedly | `project-format.test.ts`, `animation.test.ts` |
| Atomic and concurrent saves | A failed save does not damage the original file; concurrent saves finish in order, and dirty reflects only the latest persisted state | `workspace.test.ts`, `document-files.test.ts`, Rust file tests |
| Aseprite import compatibility | Valid single-frame and multi-frame pixels, layers, and durations import correctly; truncated, unknown, or out-of-bounds data fails explicitly | `aseprite.test.ts` |
| Image and GIF encoding | Static formats such as PNG preserve dimensions and transparency; GIF frame order, duration, scaling, and round-trip direction produce deterministic bytes, and every frame still decodes to exact pixels after crossing LZW code-width boundaries | `png.test.ts`, `gif.test.ts`, `raster-image.test.ts` |
| Input resource limits | Zero-sized, overflowing, oversized images, malformed projects, and clipboard data are rejected before large allocations or system calls | `resource-policy.test.ts`, `NewDocumentDialog.test.tsx`, Rust clipboard tests |
| Recovery writes and discard | Recovery saves run serially; after discard, in-flight writes finish before deletion, and late writes cannot recreate the draft | `recovery-service.test.ts`, `workspace.test.ts`, Rust recovery tests |
| Recovery capability degradation | An unwritable recovery directory or session marker records a warning without blocking the main window or editor startup | Rust `platform_recovery` tests |
| File-drop deduplication | Windows paths and `file://` paths normalize consistently; duplicate HTML, Webview, Window, and Rust events open only once and subscriptions can be re-established | `document-drop.test.ts`, `document-drop-events.test.ts`, `document-drop-service.test.ts` |
| Brush-library file boundary | Images dropped into the brush library do not open as documents; RGBA and semi-transparent pixels round-trip through storage; width or height above `256px` is rejected before disk writes; `Ctrl+B` writes only to the global library and does not dirty the project | `brushes.test.ts`, `workspace-session.test.ts`, `document-drop-service.test.ts`, `workspace.test.ts` |
| Recent-file cleanup boundary | Remove a recent entry only when its path truly does not exist; retain a file that exists but fails to parse rather than treating a read error as user deletion | `HomeWorkspace.test.tsx`, Rust `platform_files` tests |
| Clipboard snapshot isolation | Fall back to the internal snapshot when the system clipboard is unreadable; paste, transform, and cross-document operations must not rewrite source pixels | `clipboard-service.test.ts`, `workspace.test.ts` |
| Tileset slot compatibility | Empty-slot layout survives save and reopen; legacy v13 compact layout remains readable; duplicate, missing, or out-of-range slots fail explicitly; moving slots does not change tile pixels or stable references | `project-format.test.ts`, `tilemap.test.ts`, `workspace-tilemap.test.ts` |
| Shared Tilemap Tileset | Creating a Tilemap layer creates a Tileset by default or can reuse an existing Tilemap Tileset; dimensions follow the selected resource, deleting a reference does not remove a still-used resource, and the shared ID survives save and reopen | `project-format.test.ts`, `workspace-tilemap.test.ts` |
| Convert layer to Tilemap | Every frame of a normal or background layer is cut to the canvas grid, identical tiles are deduplicated, and edges are padded transparently; conversion, naming, background identity, Tileset, and session selection are all restored by the same Undo/Redo | `tilemap.test.ts`, `workspace-tilemap.test.ts`, `LayersPanel.test.tsx` |
| Paste raster selection into free tile | With no selected instance, a normal canvas selection is cropped at its original coordinates and creates a source, Tileset, and instance; with an instance selected, only its shared source is edited and all same-source instances synchronize; Undo/Redo leaves no orphan resources, while ordinary animation cels still reject paste into a free-tile or instance timeline | `free-tile.test.ts`, `workspace-tilemap.test.ts`, `command-context.test.ts` |
| Free-tile instance selection transform | A new selection targets only the active instance; normal, rotated, and mirrored instances move, scale, rotate, and skew in display orientation, with movement preview never one frame behind; results map back into the shared source and refresh same-source instances in real time; other instances show no selection overlay; one Undo/Redo restores source pixels, selection, and pivot together | `free-tile.test.ts`, `workspace-tilemap.test.ts` |
| Free-tile instance properties and row gestures | Bounds, hit testing, composition, and source synchronization remain correct after rotation or mirroring of non-square instances; property transforms preserve the displayed top-left corner and survive save/reopen and Undo/Redo; instance eye/lock supports the same `Alt` all-row and press-drag interactions as layers; multi-instance properties and deletion each produce one fully reversible history step | `free-tile.test.ts`, `workspace-tilemap.test.ts`, `project-format.test.ts`, `LayersPanel.test.tsx` |
| Preference and language fallback | Corrupt, unknown, or legacy preferences fall back safely; changing language does not translate project names, layer names, or user input | `file-preferences.test.ts`, `localization.test.ts` |
| Native title-bar drag safety | Clicking the title bar only activates the window; system drag begins only while the primary button is physically held and the pointer has crossed the drag threshold; an asynchronous request arriving after release is rejected; double-click maximize and title buttons remain usable; after maximize or restore, reset the native pointer once and clear any Windows top-border vertical-resize cursor again on the next button-free client-area movement over the title bar | `AppWindowTitleBar.test.tsx`, `app-window.test.ts`, Rust `cargo check` |

## History and Sessions

| Contract | Required result | Automated protection |
| --- | --- | --- |
| Empty history operations | Undo/Redo with no history has no side effects and does not change dirty or view state | `history.test.ts`, `workspace.test.ts` |
| One action, one history entry | Layer batches, selection transforms, adjustments, canvas resizing, and animation edits each produce one fully restorable history entry per user action | `workspace.test.ts`, `layer-operations.test.ts`, `CanvasResizeDialog.test.tsx` |
| View-state isolation | Pan, zoom, rotation, mirroring, panel layout, playback position, and tool switching do not enter document history or change dirty | `view-preview-lifecycle.test.ts`, `workspace.test.ts`, `animation.test.ts` |
| Temporary-preview isolation | Canvas-size, view, and color-adjustment previews can be canceled or internally undone without polluting document history before confirmation | `CanvasResizeDialog.test.tsx`, `AdjustmentDialog.test.tsx`, `adjustment-preview-lifecycle.test.ts` |
| In-progress path history | Freeform shapes, polygon shapes, and both lassos support point-by-point Undo/Redo before completion; undoing the final point exits the gesture and continues into document history; completion still submits only once | `canvas-input.test.ts`, `workspace.test.ts` |
| History failure recovery | If undo or redo execution fails, the original entry and memory counts remain intact and can be retried after conditions are repaired | `history.test.ts` |
| Cross-frame history targeting | Undo/Redo performed from another frame still changes the frame/cel that owns the original operation rather than the current frame | `animation.test.ts`, `workspace.test.ts` |
| Cross-document layer clipboard | Copied layers and groups preserve hierarchy, order, offsets, and properties; destination paste owns independent pixels and forms one history entry | `workspace.test.ts`, `layer-operations.test.ts` |
| Adjustment and later-operation order | When pixels or selections are edited after an adjustment is confirmed, the two histories remain strictly separate and undo/redo in their original order | `workspace.test.ts`, `history.test.ts` |

## Coordinates and Pixel Editing

| Contract | Required result | Automated protection |
| --- | --- | --- |
| Inverse view transform | After rotation, horizontal/vertical mirroring, and non-integer zoom, drawing, sampling, selection, and preview all target the same document pixel | `view-geometry.test.ts`, `canvas-input.test.ts` |
| Pointer-anchored zoom | The main canvas and Preview panel retain the document position under the pointer before and after zoom, without snapping back under rotation or mirroring | `view-geometry.test.ts`, `preview-geometry.test.ts` |
| Viewport-resize redraw | When docked or floating panels change width or height, the old Canvas bitmap keeps its original pixel ratio until the next redraw and is not stretched by CSS | `canvas-display-size.test.ts` |
| Symmetric selection hit testing | Eight handles, edge movement, rotation, and skew use continuous document coordinates; left/right/top/bottom hit areas have no fixed offset or gaps | `canvas-input.test.ts`, `canvas-visuals.test.ts` |
| Lasso and combination bounds | Lasso closure does not lose rightmost or bottommost pixels; new, add, subtract, intersect, and proportional modifiers use consistent rules | `tools.test.ts`, `selection.test.ts`, `canvas-input.test.ts` |
| Selection content outside canvas | Floating content moved outside the canvas and back retains all pixels; document bounds are applied only on confirmation | `tools.test.ts`, `workspace.test.ts` |
| Floating-selection mirror cache | After paste or move, repeated horizontal/vertical mirroring followed by movement keeps pixels, mask, and fast-path cache synchronized, without restoring an old direction, creating duplicates, or leaving non-undoable canvas content | `tools.test.ts`, `workspace.test.ts` |
| Tiled selection movement | Any visible tiled copy can hit the original selection; dragging across a copy seam or the outermost copy moves pixel by pixel in continuous document coordinates; after internal coordinates cross a canvas period, live preview does not reverse, stall, or clip seam content; confirmation wraps out-of-bounds pixels and selection into the original canvas on enabled axes, and Undo/Redo remains consistent | `canvas-input.test.ts`, `tilemap.test.ts`, `canvas-composite-cache.test.ts`, `tools.test.ts`, `workspace.test.ts` |
| Tiled tool preview | Pencil, eraser, line, shape, gradient, airbrush, and tile-paint previews appear on every visible tiled copy; large-brush outlines remain continuous when crossing bounds, sample coordinates wrap on enabled axes, edges are neither clipped nor incorrectly reassembled, and the pointer itself is not duplicated | `tilemap.test.ts` |
| Scale-across-axis flip | Scaling a selection past the opposite edge switches the matching mirror state; preview and commit agree and produce one undo entry | `canvas-input.test.ts`, `tools.test.ts`, `selection.test.ts` |
| Multi-frame canvas size | Canvas resizing applies one offset to every frame/cel; relative positions survive expansion, crop, and Undo/Redo | `animation.test.ts`, `workspace.test.ts`, `document.test.ts` |
| Adjustment preview baseline | During adjustment, movement, transform, add, and subtract always calculate from the unadjusted baseline without flashing back, repeated accumulation, or pixels leaking outside the range; linked-cel preview does not write shared source early, and confirmation plus Undo/Redo preserve link semantics | `AdjustmentDialog.test.tsx`, `adjustment-preview-lifecycle.test.ts`, `adjustments.test.ts`, `workspace.test.ts` |
| Symmetry-transform closure | Multi-axis drawing, fill, and selection calculate and deduplicate the closure, write axis pixels only once, and merge the result into one history entry | `symmetry.test.ts`, `tools.test.ts`, `selection.test.ts` |
| Initial symmetry-axis placement | The first activation of each symmetry-axis type in a project uses the current canvas center; toggling the same axis does not move it, and first-use state is isolated between projects | `workspace.test.ts` |
| Onion-skin composition | Adjacent frames composite complete visible layers; current-frame content and multi-layer occlusion do not change the onion-skin result that should be shown | `onion-skin.test.ts` |

## Animation and Layer Structure

| Contract | Required result | Automated protection |
| --- | --- | --- |
| Timeline normalization | A single-frame document establishes a valid first frame and cel; frame switching synchronizes the active editing surface, and empty cels do not rely on UI rendering to create missing data | `animation.test.ts`, `workspace.test.ts` |
| Frame structural operations | Add, duplicate, delete, and reorder frame operations update every layer cel and frame duration, and one undo restores the complete structure | `animation.test.ts`, `workspace.test.ts` |
| Cel-link lifecycle | Link, unlink, clear, delete, and paste maintain shared surfaces correctly; shared edits synchronize, and complete Undo/Redo restores relationships and pixels | `animation.test.ts`, `workspace.test.ts` |
| Batch cel clipboard | Multiple selected cels copy and paste relative to the first-cell row/column anchor, extend frames when needed, and produce one history entry for the complete operation | `workspace.test.ts`, `LayersPanel.test.tsx` |
| Animated layer copy | Copying a layer or group includes every frame/cel, empty-frame state, and property rather than only the current frame | `workspace.test.ts`, `layer-operations.test.ts` |
| Playback clock and state | The Layers and Preview panels share one clock; frame durations, speed, looping, and stop fallback are deterministic; playback does not change dirty | `useAnimationPlaybackClock.test.tsx`, `animation.test.ts` |
| Named loop sections | Multiple selected frames can create, edit, delete, and independently play forward/reverse finite or infinite loops; tag playback first repeats the innermost loop containing the current frame and falls back to the complete timeline outside a loop; nested brackets render inside parent ranges; ranges follow stable frame IDs, shrink when endpoints are deleted, remain undoable, and round-trip through v16 projects | `animation-loop-sections.test.ts`, `workspace-animation-loop-sections.test.ts`, `useAnimationPlaybackClock.test.tsx`, `project-format.test.ts`, `LayersPanel.test.tsx` |
| Nested layer structure | Move, copy, group, ungroup, and delete preserve tree order and parent-child relationships, reject cyclic parents, and avoid processing descendants twice in batch operations | `layer-operations.test.ts`, `layer-panel-layout.test.ts`, `workspace.test.ts` |
| Lock propagation | A locked group and its descendants cannot change pixels, properties, or structure; unlock and history restoration preserve explicit lock states | `layer-operations.test.ts`, `workspace.test.ts` |
| Layer merge result | Pixels produced by merging different color modes, opacity, and blend modes are deterministic; merge and Undo/Redo preserve layer order and selection | `layer-merge.test.ts`, `workspace.test.ts` |

## Platform and Release

| Contract | Required result | Automated protection |
| --- | --- | --- |
| Close-coordination race | Concurrent close, cancel, and timeout requests process only one confirmation; an old timeout after cancellation cannot exit the application | Rust `close_coordinator` tests |
| Native file dialogs | Language, filters, extensions, and actual encoding format agree; cancellation creates neither a file nor an erroneous progress state | Rust `platform_dialogs` tests, `document-files.test.ts` |
| File-association startup | Opening from a `.moonsprite` association or startup argument creates one session and enters the editor directly | `test:tauri`, `test:desktop` release gates |
| Version consistency | Package, Cargo, Tauri, and current application identifiers agree; the latest packaged version has an archive, and release switches to the current target | `version-contract.test.mjs`, `pnpm check:version -- --release` |
| Installation and thumbnail integration | Installation, first launch, file icons, thumbnail registration/unregistration, and user-file preservation follow the release checklist | `docs/release/release-checklist.md` release gate |

## Maintenance Rules

- When changing high-risk logic, find its contract first and prefer extending the tests referenced by that row.
- If a new scenario lacks automated protection, mark it as a release gate only when it is genuinely a data, compatibility, or platform-security gap. Ordinary UI must not enter the matrix as "pending."
- At each `DEV.N` release, audit duplicate and obsolete contracts. Merge equivalent semantics rather than adding rows for every debugging occurrence.
- Record performance regressions only in `performance-baseline.md` and `performance-history.md`, not in this matrix.
