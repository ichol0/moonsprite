# MoonSprite File Format v1

The `.moonsprite` file is a ZIP archive containing:

- `manifest.json`: document metadata, palette entries, layer order, and schema version.
- `layers/<id>.rgba`: little-endian RGBA bytes, four bytes per pixel.
- `layers/<id>.idx32`: little-endian unsigned 32-bit stable palette IDs.
- `preview.png`: flattened visible-layer preview.

The manifest is rejected when `app` is not `MoonSprite`, `schemaVersion` is not `1`, dimensions are invalid, or a layer binary is missing or has an unexpected byte length. Unknown future versions are not silently opened.

Indexed documents reserve color ID `0` for transparency. Other color IDs are stable across palette reordering. PNG export preserves indexed output only when the flattened image has no more than 256 unique colors; otherwise it exports equivalent RGBA pixels.
