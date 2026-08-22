# Brush and Color Contract

[中文](brush-color.md) | English

## Color

- Document color modes are RGBA, indexed, and grayscale. RGBA permits arbitrary color and alpha. Indexed canvas pixels may reference only visible colors in the current palette; every external color maps to the nearest palette color by RGBA distance and must not add a color implicitly. Grayscale preserves alpha and converts every drawing, paste, text, and conversion write to equal RGB channels using perceptual luminance.
- Foreground and background colors are independent application-level state shared by every open project. Changing either in any project or palette and switching projects must not restore an older project-specific value.
- `X` swaps foreground and background by default. The command can be changed or cleared under Shortcut Settings > Color.
- Brush left button uses foreground and right button uses background. Eyedropper and color picker use the same left/right semantics.
- Eraser left button performs transparent erase. Right-button drag replaces only pixels in the active layer and brush range whose RGBA exactly matches foreground with background; every other color remains unchanged. This continues honoring selection, basic shape or RGBA image brush, symmetry, and one-stroke undo rules, and works on RGBA and indexed layers.
- Dragging the eyedropper updates the corresponding color in real time. The eyedropper can also sample palette swatches and color-wheel or slider values. Left writes foreground; right writes background.
- Hold and Click to Add Color defaults to `Alt+S`. Pressing the shortcut alone adds nothing. While held, completing one left-button sample on canvas, palette, or color wheel adds the final foreground color to the palette. A right-button background sample does not add.
- Eyedropper tool options show foreground and background and provide Replace in Current Layer and Replace Globally. Replacement runs from foreground to background and matches exact RGBA only. Global scope includes every unlocked layer and animation frame and creates one undo step.
- After sampling, Eyedropper remains active by default. When Preferences > Editing > Return to Pencil After Eyedropper is enabled, it returns only after a completed explicit sample. Modifier-triggered temporary color picking always returns to the original tool.
- When right-clicking the color wheel or sliders to adjust background, selection point, sliders, and wheel display update together without hue jumps.
- After hue snapping or color-level changes, the selection point returns to the center of the current color region while preserving equivalent color intent.
- Palette swatches indicate both foreground and background. Foreground uses an upper-right marker and background a lower-left marker. Left-click foreground selection or right-click background selection adds a temporary blue outline to the clicked swatch. Losing swatch focus hides only the outline. Right-click never changes foreground.
- Palette Actions > Synchronize Colors is off by default. When enabled, editing a palette color exact-matches RGBA and replaces corresponding pixels across every unlocked layer and animation frame, combined with the palette change as one undo. Indexed mode changes only palette color and does not rewrite canvas pixel IDs.
- Foreground and background color-editor titles explicitly identify the role. On first open they are temporary popups and close on blur. A real title drag converts one into a persistent window that may coexist with the other editor. Each remembers a size constrained by minimum and maximum, but reopening after close uses the default position near its trigger. Channel sliders and right-side value inputs are equal height and resize through shared eight-direction handles. Default mode order is HSV, RGB, LAB, GRAY, PLT; PLT uses the current project palette. HSL and CMYK may be enabled in Preferences. The right-side eyedropper keeps the dialog open while sampling and restores the pre-sample tool afterward. Right-clicking HEX reads system text clipboard; a valid six- or eight-digit HEX applies immediately, while invalid text leaves current color unchanged.

## Brush Types

- Basic brushes are square, circle, and line and support size changes. Tool options use one current-basic-brush button; clicking opens a compact popup with the three shapes. Selection closes the popup immediately and retains existing tool preferences. A dithering-brush button to the right selects checker, directional, or Bayer templates and switches discrete phases through joined left and right steppers according to the real template matrix. Left diagonal, right diagonal, horizontal, and vertical each use six phases. Clicking the current template again disables dithering. The template panel first opens as a temporary overlay. Dragging its title converts it to a persistent floating window that no longer closes on canvas click and can be retracted through its title close button. The pattern is fixed in pixel coordinates and automatically clipped to current brush size and shape. Hover preview, straight-line preview, and final write share one mask. Dithering settings persist separately for pencil, eraser, and line, but affect only basic brushes when no image brush is selected. Circle masks use integer hard-edge ellipse scanlines shared by preview and painting, not a continuous-distance threshold that turns small circles into solid squares.
- Image brushes preserve source RGBA pixels, transparency, and original dimensions and are no longer converted into grayscale coverage brushes. Width or height above `256px` must be explicitly rejected during import or selection creation and must not be silently resized.
- Crack, wood, grain, and procedural textures are system textures available only to Paint Bucket and generated once according to fill-region rules to avoid repeated accumulation. Static Texture Size and each procedural texture size parameter are in canvas pixels and must not inherit brush size from another tool. An independent Dither toggle switches procedural textures between ordered pixel dithering and a hard threshold; antialiasing remains separate. Pencil, Eraser, and Line always ignore system textures but may use RGBA image brushes from the Pattern Brush panel.
- Paint Bucket modifies only pixels in the real selection mask for both rectangular and non-rectangular selections. Contiguous and non-contiguous modes obey the same restriction.
- Custom brushes can be imported from image files or created from the current selection with `Ctrl+B`. Both save under the executable-root `brushes` folder, do not enter current project data or dirty state, and use intrinsic size without a size parameter. Embedded project brushes from old projects remain readable, selectable, and deletable.
- Pencil, Eraser, and Paint Bucket each store basic-brush settings. Non-basic brushes and brush mode are shared across compatible tools.

## Pattern Brush Panel

- Pattern Brush is a normal panel shown on the right by default. Like other panels it can dock left, right, or bottom, float, resize, hide, or be summoned by a configurable popup-panel shortcut, default `6`. The Pattern Brush button beside the basic brush in tool options toggles panel visibility with one click.
- The title bar provides Add, Delete, and Manage. Add can multi-select PNG, JPEG, WebP, BMP, or GIF and images can be dragged directly into the panel. Manage offers three thumbnail sizes, `30 / 40 / 52 px`, supports `Ctrl+wheel`, and can open the local brush folder.
- A brush cell shows one complete RGBA brush unit. Transparent pixels reveal the panel background directly and do not draw a checkerboard or substitute color. No extra surface appears when idle; hover shows the theme hover surface; selection uses the same outline as palette swatches. Ordinary click replaces selection, `Ctrl` toggles discontiguous selection, and `Shift` selects a range. The brush currently used for drawing remains highlighted after panel blur and is canceled only by clicking that sole selected brush again or switching to a basic brush. Clicking a brush also makes it active.
- Local brushes can be press-dragged to reorder, stored in `brushes/.brush-order.json`. Dropping in blank space after the grid moves to the end. `Delete` or `Backspace` deletes temporarily selected brushes and must confirm before removing disk files. Embedded compatibility brushes follow project-data deletion rules.

## Brush Dynamics

- Pencil and Eraser store Ase-style dynamics separately. Size, drawing strength, and color gradient may independently map to pressure or speed. Pencil strength means opacity; Eraser strength means erase amount; color gradient applies only to Pencil.
- All three effects output `0..100%`. Size is relative to base size and ends at least `1px`. Gradient `0%` is background and `100%` foreground; a forward pressure map approaches foreground as pressure increases.
- Pen pressure is calibrated by `100 * pow(clamp((p - 0.02) / 0.98, 0, 1), 1.7)`. A new pressure map defaults to input `0..70` with a hard curve. Only input with `pointerType` equal to `pen` participates; non-pen or missing pressure bypasses the map.
- Speed is client CSS pixels per second with a time-aware EMA. First value and straight-line connection use `0`; zero elapsed time reuses existing speed; a pause of `160ms` resets to zero. Speed input is hard-limited to `4000 CSS px/s`, with new mappings defaulting to `50..2400`.
- Every mapping independently sets input range, output range, soft/linear/hard curve, and forward/reverse direction. Missing speed resolves as `0`, so forward uses the output minimum and reverse the maximum.
- Dynamic gradient independently selects the same nine dither modes as the Gradient tool. Directional dithers use six-stage matrices. Every final document pixel resolves threshold from absolute coordinates. `none` interpolates RGBA directly; other modes dither between the two RGBA endpoints, with transparent endpoints following Gradient semantics.
- Intrinsic-size custom brushes ignore size mapping but still apply strength and color gradient. With gradient enabled, preserve imageBrush shape, source alpha, and coverage while RGB uses current dynamic color. Without gradient, use the brush's own color. Eraser and right-button foreground replacement ignore color gradient.
- Coalesced pointer events and perfect-pixel paths retain size, strength, and gradient amount, endpoints, and dither description. Long segments interpolate between start and end samples. Dynamic size uses an envelope in size space: each raster step changes by at most `max(1, ceil(baseSize / 6))`, multiplied by distance when crossing multiple raster steps. The first point uses target size directly.
- Dynamic-size stamp spacing uses each candidate's actual size and accumulated path steps since the previous stamp. Whenever integer size differs from the previous actual stamp, stamp that candidate. Apply spacing only after size stabilizes. Always draw first and last, draw zero length once, and use the same rules for raster and balanced paths.
- Repeated hits on a pixel within one stroke always recompute from pre-stroke color and achieved coverage. Event density must not accumulate opacity or dynamic color repeatedly. Indexed mode reuses the same palette color and does not continuously create duplicates.
- Live pressure and speed telemetry travels only through an in-memory channel published at most once per frame. It never enters Workspace, session, dirty state, undo, recovery, or saved data. Hover and drawing both publish. Leaving canvas or unmounting becomes inactive, and speed displays `0` after `160ms` stopped.
- Legacy pressure settings and v2/v3 dynamics migrate automatically to v4. v2/v3 gradient dithering migrates to `none`. v2 factory pressure and speed mappings migrate to new default input ranges, while user-custom mappings remain. v4 mappings and dithering persist locally per Pencil and Eraser, do not affect dirty state or undo, and one complete stroke still commits one pixel edit and one undo step.

## Symmetry Drawing

- Pencil, Eraser, shapes, and Paint Bucket share horizontal, vertical, upper-right-to-lower-left, upper-left-to-lower-right, and rotational symmetry icon buttons. Modes combine freely and persist with tool settings.
- The first time each symmetry axis in a project changes from off to on, the shared symmetry center uses the current canvas center. Repeated toggles of that axis do not move it. First enabling another never-used axis relocates to the current canvas center. Guides are solid lines with configurable color, alpha, and thickness. When unlocked, hovering the center or a line shows Move. Dragging the center moves every axis; dragging one line adjusts the shared center along that line's normal. Positions snap to half pixels. The More menu can lock guides, change appearance, or reset center to current canvas center. Pivot changes are tool state and do not enter document history.
- The horizontal axis reflects top and bottom, the vertical axis left and right, and the two diagonals reflect along upper-right-to-lower-left and upper-left-to-lower-right. Diagonal results outside a rectangular canvas are discarded.
- Brush pixels, color, alpha, pattern, and shape generate an original result first and then reflect through shared coordinate mapping. Duplicate target pixels from multiple axes are deduplicated. Preview, cache invalidation range, and final write use the same target set.
- With symmetry enabled, brush preview shows only the original point under the mouse and does not duplicate at mirrored positions. Actual drawing still writes every mirrored position.
- Paint Bucket first generates deduplicated mirrored seeds, applies identical contiguous or non-contiguous rules to each, and merges all regions into one pixel edit and one undo.

## Custom Brush Color

- An ordinarily imported image always retains source RGBA. Foreground or background changes must not remap multicolor or translucent pixels.
- A brush created from selection first preserves its original multicolor pattern. Afterward, when colors change, light pixels map to foreground, dark pixels to background, and transparent pixels stay transparent.
- After a selection brush is written successfully to the local Pattern Brush library, clear the original selection, switch to Pencil, and select that brush immediately. On write failure, retain original selection and current tool.

## Pattern Modes

- Paint Brush is the default mode for new and reset tool configuration and appears first. Existing versioned configuration retains a user's explicit mode.
- All three modes use the shared themed select and describe tiling origin or stamping behavior directly in each option. Detail preview shows the custom brush's saved original multicolor pixels and must not force them to one foreground color.
- Pattern Aligned to Source: tiling coordinates are fixed in brush-source coordinates, so one canvas position always gets the same pattern.
- Pattern Aligned to Target: still tiles, but the first paint point is the tiling origin. Preview must align with actual placement.
- Paint Brush: in overwrite mode, every stamp replaces non-transparent pattern pixels along the path in order. Later stamps fully cover earlier stamp pixels. Fully transparent pattern pixels do not change the layer underneath.
- Straight-line connection with `Shift` reuses the same stamp centers and overwrite order in preview and confirmation.

## Airbrush

- Airbrush emits one particle batch immediately on press and continues at the Particle Frequency interval in milliseconds while held. It continues spraying while the pointer is stationary.
- Particle Radius controls each particle's pixel radius, Scatter Radius controls a circular uniform-random region around the pointer, and Particle Density controls particles per batch.
- Airbrush follows foreground/background, selection, layer mask, indexed-color, and symmetry rules. One complete hold commits one pixel edit and one undo. Cancel, window blur, or window switch restores the entire uncommitted spray.
- Timed spraying uses one frame scheduler. Particle generation must not follow pointer-event frequency and must not emit an unbounded backlog after a stall.

## Preview

- Preview shape and actual write mask come from the same data.
- With tiled preview enabled, live pixels, edges, and operation-line previews for Pencil, Eraser, Line, shapes, Gradient, Airbrush, and tile painting appear in every visible duplicate. Brush outline keeps one continuous original geometry across seams. Color sampling folds onto the original canvas through enabled axes. Out-of-bounds parts must not be clipped or reassembled incorrectly. The mouse pointer still appears only once.
- Preferences > Tool Preview controls brush preview style. Default is Full Preview, with None, Edge Only, Full Preview, or Full Preview with Edge. Show Brush Edge While Drawing appears only for Full Preview with Edge and controls whether the edge outline remains while held drawing.
- Pencil and Eraser line-connection modifiers are configured in Shortcut Settings. The live-preview toggle under Preferences > Editing controls only whether a temporary segment appears while the modifier is held and does not change final drawing on release. Confirmed commands such as Flip Content clear old line anchors and previews.
- Preferences > Editing > Optimized Line Algorithm is enabled by default. When enabled, line connection and polygon-lasso edges distribute major-axis pixels into even steps of similar lengths. Reverse connection produces the same pixel set, and preview and final result share the same algorithm. When disabled, fall back to the traditional raster line.
- During line connection, triggering Constrain Line Direction, default `Shift+Ctrl`, snaps the endpoint to the closest allowed direction. A Line Diagonal Step value of `1` provides horizontal, vertical, and 45° for eight directions. Values above `1` provide 12 directions through `N:1` and `1:N` pixel steps; `2` corresponds to approximately 30° and 60°. The constrained endpoint lands on a complete step period so starting, intermediate, and ending steps each contain exactly `N` major-axis pixels. Preview and final painting use the same endpoint and point sequence.
- The Pencil tool option Step edits the same Line Diagonal Step value from `1-16`, applies immediately, persists, and stays synchronized both ways with Preferences.
- An existing line anchor counts as the first pixel of the initial step. For value `6`, the anchor and following five major-axis pixels form the first step; no seventh pixel is added.
- When repeatedly connecting straight segments with translucent color, all segments share pre-stroke underlying pixel color. Junctions and later crossings must not accumulate alpha again, while each segment retains correct undo range.
- Changing parameters of a non-basic brush must not flash a basic circle or square preview.
- Pointer black-or-white contrast is based on the final composite under the pointer, including preview color, not only the active layer or pending paint color.
