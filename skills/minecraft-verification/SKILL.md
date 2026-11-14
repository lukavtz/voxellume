---
name: minecraft-verification
description: Use when a change needs proof, an acceptance check must be run, or a build, server, client, or GameTest result must be reported honestly.
---

# Minecraft verification

Proof is an observed exit code or a file that exists on disk. There is no evidence
manifest, no report schema, and no second channel: `minecraft_run` returns the exit
code, the status, and the log path, and that is the whole record.

## Proof table

| Goal                     | Task          | Observed proof                                                                                   |
| ------------------------ | ------------- | ------------------------------------------------------------------------------------------------ |
| Compiles and packages    | `build`       | `status: "exited"`, `exitCode: 0`, and a `.jar` under `build/libs` that is not `-sources`/`-dev` |
| Dedicated server boots   | `runServer`   | `stopOnLog: "Done \\("` yields `status: "stopped_by_log"` and `tail` contains `Done (`           |
| Client boots and renders | `runClient`   | `status: "stopped_by_log"` on a client-ready line, the log, and a screenshot you took yourself   |
| Loader GameTests pass    | `runGametest` | `status: "exited"`, `exitCode: 0`, and the log contains `All required tests passed`              |
| Sources generated        | `genSources`  | `exitCode: 0` and the generated sources directory exists                                         |

Any other status — `timed_out`, `cancelled`, `output_limit_reached`, `spawn_failed`
— is not a pass. `exitCode: null` is not a pass.

## Procedure

1. State the claim before running anything: "the mod builds", "the server starts with
   the mod loaded", "the item renders". One claim, one run.
2. Pick the row from the table. Choose `timeoutSeconds` from the observed duration of
   a previous run, not from hope; the maximum is 3600.
3. Run it with `minecraft_run`. Keep the whole result: `argv`, `status`, `exitCode`,
   `durationMs`, `logPath`, `tail`.
4. Check the artifact, not only the exit code. Read `build/libs` for the JAR, grep the
   log for the marker line, list the screenshot file.
5. On failure, read the log at `logPath`. Repair one cause, then rerun the same task.
   Preserve the failing log path in your report. Stop after three attempts.
6. Report the run you performed. Never report a check you did not execute.

## Rules

- Never write "works", "done", "fixed", or "verified" without a `minecraft_run`
  result whose status and exit code you quote.
- A green preview render, a Blockbench export, or a PNG diff is not runtime proof.
- Extra flags are limited to `--offline`, `--info`, `--stacktrace`. Anything else is
  `unsafe_argument`, and that is the correct outcome — do not try to work around it
  with a shell command.
- Do not accept a server EULA for the user. If `runServer` fails on EULA, report it.
- Codes and statuses: [PLUGIN-SPEC.md section 6](../../docs/PLUGIN-SPEC.md#6-minecraft_run).

## Output

Return, per claim: the task, the exact `argv`, `status`, `exitCode`, `durationMs`,
the log path, and the artifact path or marker line observed. List unrun checks as
unrun.
