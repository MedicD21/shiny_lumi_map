# Lumiose City Interactive Map Editor

Vanilla HTML/CSS/JS + Leaflet (CRS.Simple) single-page tool to annotate the Lumiose City map with benches, ladders, elevators/arrows, and custom circles. Works fully offline (no backend) and persists edits locally.

## Quick start
1. Default map is `ZA_Lumiose_City_Night.png` (3535x3535). You can swap via the file picker or by changing the path field.
2. Ensure icon assets live at `assets/icons/icon_bench.png`, `icon_ladder.png`, `icon_arrow.png`.
3. Serve the folder with a simple local server (needed for `fetch` + localStorage in browsers). Examples:
   - `python3 -m http.server 8000`
   - `npx http-server .`
4. Open `http://localhost:8000` and toggle layers to display markers.

## Files
- `index.html` – page shell, Leaflet CDN, control panel, modal scaffolding.
- `styles.css` – dark UI theme, panel, modal, and marker visuals.
- `app.js` – single `App` module handling map setup, layers, editing, autosave, export.
- `markers.json` – starts empty; export writes compatible JSON.
- `assets/icons/` – bench, ladder, arrow icons used by icon markers.

## Using the editor
- **Map & scale**: locked to `ZA_Lumiose_City_Night.png` at 3.2689 px/unit; bounds are preconfigured.
- **Modes**: Measure (M) draws a line from the draggable origin marker; Add (P) places a marker on click; Edit (E) enables dragging/editing of all markers (including presets).
- **Layers**: markers stay hidden until you toggle both a source (Presets/User) and a type (Benches/Ladders/Elevators/Circles). Layer groups use Leaflet `LayerGroup`s for clean visibility control.
- **Add settings**: choose type, label, and color (for circles). Snap-to-grid is on by default; adjust grid size or disable from the Snap section.
- **Inspector**: select a marker to edit its label/type/color in Edit mode. Delete via popup (preset deletions ask for confirmation).
- **Export**: download or copy JSON for all/preset/user markers. Export is sorted by type then label and uses the schema below. With no presets included, everything you place is treated as user markers until you add presets.
- **Zoom**: markers scale with zoom to stay readable while navigating the map.
- **Shiny radius**: always visible teal marker with two rings (50u and 70u diameters). Drag it anywhere; rings follow the locked scale.
- **Reset**: two-step modal. By default clears only user markers; optionally clear preset edits too (reverts to `markers.json`).

## Marker schema
```json
{
  "id": "string-uuid-or-stable-id",
  "type": "bench" | "ladder" | "elevator" | "circle",
  "label": "string",
  "lat": number,
  "lng": number,
  "color": "#RRGGBB", // circle only
  "source": "preset" | "user"
}
```
`markers.json` can omit `id`/`source`; the app fills them in and persists them locally.

## Autosave & storage
- Every add/move/edit/delete is autosaved (debounced) to `localStorage` under `lumiose-map-state-v1`.
- Snap/grid settings persist; scale is fixed.
- Reset clears localStorage entries for markers (and optionally preset edits).

## Scaling notes
- The map bounds are derived from image dimensions: `[ [0,0], [height / pixelsPerUnit, width / pixelsPerUnit] ]`.
- Coordinate system is fixed for this map; marker lat/lng values are stored in map units using the locked scale.

## Keyboard shortcuts
- M: Measure mode
- P: Add mode
- E: Edit mode
- 1/2/3/4: Bench/Ladder/Elevator/Circle tool
- Delete/Backspace: delete selected (Edit mode only)
- Esc: close popups/modals, exit Add mode

## What to provide
- Confirm pixel-per-unit value you want to lock in for production (default is 1, dimensions from `ZA_Lumiose_City_Night.png` are 3535x3535).
- Any initial marker sets (currently starts empty).
