"""Static mesh QA report for a Blender scene.

Usage:
    blender -b model.blend -P qa_report.py -- --out qa.json

Reports triangle count, non-manifold edge count, faces without UVs, objects with
unapplied transforms, and materials without an image texture. It uses only ``bpy``
and the Python standard library.
"""

from __future__ import annotations

import argparse
import json
import sys

try:  # bpy exists only inside Blender; keeping the import soft lets py_compile pass.
    import bpy  # type: ignore
except ImportError:  # pragma: no cover - exercised outside Blender only
    bpy = None  # type: ignore


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Report mesh and material problems.")
    parser.add_argument("--out", required=True, help="Path of the JSON report")
    return parser.parse_args(argv)


def identity(matrix) -> bool:
    return all(
        abs(matrix[row][column] - (1.0 if row == column else 0.0)) < 1e-6
        for row in range(4)
        for column in range(4)
    )


def non_manifold_edges(mesh) -> int:
    counts: dict[tuple[int, int], int] = {}
    for polygon in mesh.polygons:
        keys = polygon.edge_keys
        for key in keys:
            counts[key] = counts.get(key, 0) + 1
    return sum(1 for count in counts.values() if count != 2)


def faces_without_uv(mesh) -> int:
    if not mesh.uv_layers:
        return len(mesh.polygons)
    missing = 0
    for polygon in mesh.polygons:
        if all(
            mesh.uv_layers.active.data[index].uv.length < 1e-6
            for index in polygon.loop_indices
        ):
            missing += 1
    return missing


def inspect_object(obj) -> dict:
    mesh = obj.data
    mesh.calc_loop_triangles()
    return {
        "object": obj.name,
        "triangles": len(mesh.loop_triangles),
        "nonManifoldEdges": non_manifold_edges(mesh),
        "facesWithoutUVs": faces_without_uv(mesh),
        "unappliedTransform": not identity(obj.matrix_basis),
        "materialsWithoutImageTexture": [
            slot.material.name for slot in obj.material_slots if not has_image(slot.material)
        ],
    }


def has_image(material) -> bool:
    if material is None or not material.use_nodes or material.node_tree is None:
        return False
    return any(
        node.type == "TEX_IMAGE" and node.image is not None
        for node in material.node_tree.nodes
    )


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    if bpy is None:
        print("qa_report: run this script inside Blender (-b -P)", file=sys.stderr)
        return 2

    objects = [
        inspect_object(obj)
        for obj in bpy.context.scene.objects
        if obj.type == "MESH"
    ]
    report = {
        "objects": objects,
        "totals": {
            "triangles": sum(item["triangles"] for item in objects),
            "nonManifoldEdges": sum(item["nonManifoldEdges"] for item in objects),
            "facesWithoutUVs": sum(item["facesWithoutUVs"] for item in objects),
            "objectsWithUnappliedTransform": sum(
                1 for item in objects if item["unappliedTransform"]
            ),
            "materialsWithoutImageTexture": sum(
                len(item["materialsWithoutImageTexture"]) for item in objects
            ),
        },
    }
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, sort_keys=True)
        handle.write("\n")
    print(json.dumps(report["totals"], sort_keys=True))
    return 0


if __name__ == "__main__":
    arguments = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]
    sys.exit(main(arguments))
