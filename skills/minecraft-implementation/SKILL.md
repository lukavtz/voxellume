---
name: minecraft-implementation
description: Use when turning an agreed mod feature into code, working in small red-green slices against the four plugin tools.
---

# Minecraft implementation

Implement one vertical slice at a time. A slice is one behaviour, its data and
resources, and one check that fails before the change and passes after it.

## Inputs

- A project created by `minecraft_project_scaffold`, or an existing one you have read.
- The pin from `minecraft_target_info`.
- One feature statement and the check that will prove it.

## Procedure

1. Record the baseline: `minecraft_run` with `build` before you change anything. A
   project that does not build has no baseline.
2. Write the failing check first: a JUnit test under `src/test/java`, or a GameTest
   under the test source set. `minecraft_run` with `test` or `runGametest` must show
   it failing for the right reason.
3. Implement the minimum that makes it pass. Follow the loader skill
   (`minecraft-fabric` or `minecraft-neoforge`); loader APIs and mappings come from
   the pin, not from memory.
4. Rerun the same check, then `build`. Both must pass before the next slice.
5. Keep the diff inside the slice. Unrelated refactors are separate slices.
6. Hand runtime and visual claims to `minecraft-verification`.

## Rules

- One cause per change. No drive-by reformatting, no version bumps, no new
  dependencies without saying why.
- Never edit `build/`, `.gradle/`, or generated data by hand.
- Never write "done" without a `minecraft_run` result. Compilation is not behaviour.
- Keep assets out of the slice: route them through `minecraft-assets`.

## Output

Return the changed paths, the failing-then-passing evidence for each slice, and the
build result. Say explicitly which claims remain unproven.
