-- A small read-only MSE API smoke example.
-- app.* remains the Aseprite-compatible surface; mse.* is MoonSprite-specific.

local document = mse.document.info()
local selection = mse.selection.info()

print(string.format(
  "%s (%dx%d, %s), frame %d",
  document.name,
  document.width,
  document.height,
  document.colorMode,
  document.frame
))

if selection.empty then
  print("No non-empty selection")
else
  print(string.format(
    "Selection: %dx%d at (%d, %d)",
    selection.bounds.width,
    selection.bounds.height,
    selection.bounds.x,
    selection.bounds.y
  ))
end

if not mse.isSupported("tiles.createLayer") then
  print("Tilemap scripting is not available in this runtime yet")
end
