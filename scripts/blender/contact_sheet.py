"""Render evenly spaced frames of the current scene as separate PNG files.

Usage:
    blender -b model.blend -P contact_sheet.py -- --frames 8 --out renders

Renders N frames spread across the scene frame range into ``frame-000.png`` and
writes the file list to ``<out>/frames.json``. It composes no grid; composing is a
separate step. It uses only ``bpy`` and the Python standard library.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

try:  # bpy exists only inside Blender; keeping the import soft lets py_compile pass.
    import bpy  # type: ignore
except ImportError:  # pragma: no cover - exercised outside Blender only
    bpy = None  # type: ignore


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Render evenly spaced preview frames.")
    parser.add_argument(
        "--frames", type=int, default=8, help="Number of frames to render (default 8)"
    )
    parser.add_argument("--out", required=True, help="Directory for the PNG files")
    return parser.parse_args(argv)


def sample_frames(start: int, end: int, count: int) -> list[int]:
    if count <= 0:
        raise ValueError("--frames must be positive")
    if count == 1 or end <= start:
        return [start]
    step = (end - start) / (count - 1)
    return sorted({int(round(start + step * index)) for index in range(count)})


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    if bpy is None:
        print("contact_sheet: run this script inside Blender (-b -P)", file=sys.stderr)
        return 2

    scene = bpy.context.scene
    os.makedirs(args.out, exist_ok=True)
    frames = sample_frames(scene.frame_start, scene.frame_end, args.frames)
    rendered: list[str] = []

    for index, frame in enumerate(frames):
        scene.frame_set(frame)
        path = os.path.join(args.out, "frame-%03d.png" % index)
        scene.render.filepath = path
        scene.render.image_settings.file_format = "PNG"
        bpy.ops.render.render(write_still=True)
        rendered.append(path)

    manifest = os.path.join(args.out, "frames.json")
    with open(manifest, "w", encoding="utf-8") as handle:
        json.dump(rendered, handle, indent=2)
        handle.write("\n")
    print(json.dumps(rendered))
    return 0


if __name__ == "__main__":
    arguments = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    sys.exit(main(arguments))
