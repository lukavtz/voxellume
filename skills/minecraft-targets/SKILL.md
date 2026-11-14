---
name: minecraft-targets
description: Pick an exact Minecraft Java and loader version from the pinned data, and read the exact toolchain versions that pin implies.
---

# Minecraft targets

`targets/pins.json` is plain data: 68 Java pins with exact Minecraft, loader,
loader version, API version, Gradle plugin, JDK, Gradle, and mappings. There are no
statuses, no qualification labels, and no support catalogue. A pin either carries a
template or it does not.

## Procedure

1. Call `minecraft_target_info` with the requested coordinates.

   ```json
   { "minecraft": "1.21.1", "loader": "fabric" }
   ```

   Filters are exact strings and combine with AND. An empty `pins` array is a
   normal answer meaning "no pinned target", not an error.

2. Read the pin. Do not restate versions from memory or from a tutorial: the pin is
   the authority for `loaderVersion`, `apiVersion`, `gradlePlugin`,
   `gradlePluginVersion`, `jdk`, `gradle`, and `mappings`.
3. Check `template`. Only `java-fabric-1.21.1` has one
   (`templates/fabric-1.21.1`). A pin with `template: null` cannot be scaffolded by
   `minecraft_project_scaffold`; scaffolding it returns `template_missing`.
4. For a pin without a template, build the project from the loader's own
   documentation using the exact versions the pin lists. Never substitute a nearby
   Minecraft release, loader, or mappings kind.
5. Pass the chosen pin id to `minecraft_project_scaffold` as `pinId`, and to
   `minecraft_run` only through the project it produced.

## Rules

- One pin per project. Record its `id` in the project notes.
- The JDK in the pin is the JDK the build needs. `jdk: 21` with JDK 25 installed
  means the build is unsupported until JDK 21 is present.
- Gradle tasks come from `minecraft_run`'s allowlist only. Never widen it.
- Parameter details: [docs/TOOLS.md](../../docs/TOOLS.md). Version data semantics:
  [PLUGIN-SPEC.md section 4](../../docs/PLUGIN-SPEC.md#4-minecraft_target_info).

## Output

Return the chosen pin object, its `template` value, and the exact toolchain versions
downstream steps must use.
