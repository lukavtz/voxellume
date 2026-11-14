---
name: minecraft-blender
description: Use when a Blender scene needs animation loop, contact-sheet, or mesh QA checks before its output is imported as a Minecraft model or texture source.
---

# Minecraft Blender

Three fixed scripts under `scripts/blender/` do the checks. They use only `bpy` and
the Python standard library. Run them with `blender -b -P`; the model path is the
first positional file and script arguments follow `--`. Python 3.10 or newer.

## `loop_check.py`

Confirms a clip's first and last frame hold the same pose.

```sh
blender -b model.blend -P scripts/blender/loop_check.py -- --clip Walk --out report.json
```

- Compares location, rotation (Euler or quaternion), and scale of every bone or
  object animated in the clip, using tolerance `1e-4`.
- Writes `{ "clip": "Walk", "loop": true, "maxDelta": 0.0 }`.
- `loop: false` means the clip pops; fix the keys or export it as a one-shot.

## `contact_sheet.py`

Renders evenly spaced frames as separate images. It does not compose a grid.

```sh
blender -b model.blend -P scripts/blender/contact_sheet.py -- --frames 8 --out renders
```

- Renders `--frames` frames spread across the scene frame range into
  `renders/frame-000.png`, `frame-001.png`, and so on.
- Prints and writes a JSON list of the files it rendered.
- Uses the scene's existing render settings and camera. Set them before running.
- The PNGs are previews. They prove nothing about the game.

## `qa_report.py`

Static mesh report for an asset source.

```sh
blender -b model.blend -P scripts/blender/qa_report.py -- --out qa.json
```

Reports, per object and in total: triangle count, non-manifold edge count, faces
without UVs, objects with unapplied transforms, and materials with no image texture.
Non-manifold edges and unapplied transforms are the usual causes of a model that
looks wrong after export.

## Workflow

1. Model in Blender, keep the `.blend` outside `src/main/resources/`.
2. Run `qa_report.py`; fix geometry and transforms before export.
3. Run `loop_check.py` for every looping clip.
4. Render a contact sheet for review, then export to Blockbench or to Java Block/Item
   JSON.
5. Validate the exported files in the project with `minecraft_assets_check`, and prove
   loading with `minecraft_run`.

## Output

Return the JSON reports, the preview file paths, and the validation and run results
that followed.
