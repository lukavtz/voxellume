---
name: minecraft-release
description: Use when a proven mod build needs packaging, checksums, or a version-tagged delivery, or when the build artifact must be inspected before shipping.
---

# Minecraft release

Release only what a `minecraft_run` result proves. A JAR nobody loaded is a file, not
a release.

## Inputs

- A passing `build` result and the JAR path under `build/libs`.
- The pin id, the mod version, and the license.
- The list of runtime checks that passed, with their log paths.

## Procedure

1. Require proof. For each claimed capability, name the `minecraft_run` task, its
   `status`, and its `exitCode`. Anything unrun stays listed as unrun.
2. Inspect `build/libs`. Exactly one production JAR per pin: no `-sources`, no `-dev`,
   no duplicate versions. Read the JAR's `fabric.mod.json` or `neoforge.mods.toml` and
   confirm the id and version match the release.
3. Confirm the version. `gradle.properties` `version`, the metadata version, and the
   tag must agree. Do not bump the version as part of a release commit you also use to
   fix code.
4. Record hashes. Compute the SHA-256 of the JAR and of any tarball you produce.
5. List what ships: the JAR, the license, and a short install line. Exclude `build/`,
   `.gradle/`, logs, worlds, and screenshots.
6. Deliver with git. The orchestrator commits and tags; never force-push, never amend
   someone else's commit.

## Rules

- No release claim without an observed run: `build` for the JAR, and the runtime task
  for any compatibility statement.
- A server that only booted is not a client claim. A client screenshot is not a
  server claim.
- Third-party material keeps its own license under `THIRD_PARTY/`.

## Output

Return the artifact paths with hashes, the proof table of tasks and results, the
shipped file list, and the tag. Name every unproven claim.
