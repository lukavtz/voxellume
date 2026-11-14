"""Compare the first and last pose of one animation clip.

Usage:
    blender -b model.blend -P loop_check.py -- --clip Walk --out report.json [--tolerance 1e-4]

The script evaluates every animated location, rotation, and scale channel at the
clip's first and last frame and reports the largest absolute difference. It uses
only ``bpy`` and the Python standard library.
"""

from __future__ import annotations

import argparse
import json
import sys

try:  # bpy exists only inside Blender; keeping the import soft lets py_compile pass.
    import bpy  # type: ignore
except ImportError:  # pragma: no cover - exercised outside Blender only
    bpy = None  # type: ignore

POSE_CHANNELS = ("location", "rotation_euler", "rotation_quaternion", "scale")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check whether a clip loops cleanly.")
    parser.add_argument("--clip", required=True, help="Action name to inspect")
    parser.add_argument("--out", required=True, help="Path of the JSON report")
    parser.add_argument(
        "--tolerance",
        type=float,
        default=1e-4,
        help="Largest accepted first/last difference (default 1e-4)",
    )
    return parser.parse_args(argv)


def find_action(name: str):
    action = bpy.data.actions.get(name)
    if action is not None:
        return action
    for candidate in bpy.data.actions:
        if candidate.name.lower() == name.lower():
            return candidate
    return None


def is_pose_channel(data_path: str) -> bool:
    return any(data_path.endswith(channel) for channel in POSE_CHANNELS)


def measure(action) -> float:
    frame_start, frame_end = action.frame_range
    max_delta = 0.0
    for fcurve in action.fcurves:
        if not is_pose_channel(fcurve.data_path):
            continue
        first = fcurve.evaluate(frame_start)
        last = fcurve.evaluate(frame_end)
        delta = abs(first - last)
        if delta > max_delta:
            max_delta = delta
    return max_delta


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    if bpy is None:
        print("loop_check: run this script inside Blender (-b -P)", file=sys.stderr)
        return 2

    action = find_action(args.clip)
    if action is None:
        report = {
            "clip": args.clip,
            "loop": False,
            "maxDelta": None,
            "error": "clip_not_found",
        }
        with open(args.out, "w", encoding="utf-8") as handle:
            json.dump(report, handle, indent=2, sort_keys=True)
            handle.write("\n")
        print(json.dumps(report, sort_keys=True))
        return 1

    max_delta = measure(action)
    report = {
        "clip": action.name,
        "loop": max_delta <= args.tolerance,
        "maxDelta": round(max_delta, 9),
    }
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, sort_keys=True)
        handle.write("\n")
    print(json.dumps(report, sort_keys=True))
    return 0 if report["loop"] else 1


if __name__ == "__main__":
    arguments = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    sys.exit(main(arguments))
