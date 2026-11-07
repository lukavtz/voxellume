# Runtime adapter research

Primary-source inspection used immutable Git blobs at the revisions below. No adapter was launched and no runtime capability is claimed.

| Adapter                       | Exact revision                             | Qualified target for pilot | Important limitations                                                                                                                                                 |
| ----------------------------- | ------------------------------------------ | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CreeperHost/modlens-mcp       | `ba2020c226b51858d157bc943ed13f1c6b578514` | `26.3`                     | Launch/input/screenshot/events exist; no world creation, command channel, behavior assertion, or real-tick primitive. Runtime close does not kill the game.           |
| rogalKraft/mcp-rogal          | `c153433ae8b043afee755d885808c519291103af` | Fabric `26.2`              | Requires an already-loaded world and visible client; no process launch/world creation/assertion/cancellation API. Safety regexes are not a sandbox.                   |
| ArclightPowered/minecraft-mcp | `d9387740f005fb5f3fe3c4d2cc97787588448f36` | Fabric/NeoForge `1.21.1`   | World join/input/scenario assertions/screenshots exist; no process launch and no true-tick guarantee. Scenario directories and server commands require facade denial. |

The facade allows only literal loopback endpoints, per-run secrets held outside evidence, no `Origin` header, bounded requests, authorized screenshot roots, and exact owned-PID cleanup. ModLens, rogal, and Arclight are never enabled together. Unsupported operations return `unsupported`; cancellation may return `unknown`. Every adapter must pass vanilla launch, isolated-world setup, input, state assertion, screenshot, cancellation, and cleanup before any production use.

License notices are preserved in `THIRD_PARTY/`. The mcp-rogal pin switches `LICENSE` to MIT while its README, `fabric.mod.json`, and Modrinth metadata still say CC0; that contradiction is recorded for legal review and is not copied into generated artifacts. Arclight's short upstream `LICENSE` is preserved verbatim. ModLens additionally documents vendored ASM 9.9.1 under BSD-3-Clause.

Source maps and non-claims were checked against `RUNTIME.md`, runtime hubs/protocols/request dispatch, client tool registries, screenshot implementations, and license files at the exact revisions above. Author-provided validation statements are not Voxellume runtime evidence.

## Live pilot results

### mcp-rogal Fabric 26.2

Evidence: `/tmp/voxellume-runtime-research/rogal-live/evidence/fabric-26.2-java25` (`qualification.json`, `supply-chain.json`, `evidence-hashes.txt`, `live-world.png`). Launch, isolated-world creation/reload, text/Enter input, independent gold-block placement/readback, real 1708×960 OpenGL screenshot, and exact process/world cleanup passed. Request-scoped cancellation returned HTTP 202 but ran to completion; several mouse/button actions and the inventory key failed. The result is **failed qualification**, not `supported`: cancellation and full input coverage remain unproven. Only OpenGL was exercised; no Vulkan, production-JAR, dedicated-server, or modpack claim is made. The MIT/CC0 contradiction and floating Loom `1.17-SNAPSHOT` are preserved as limitations, not silently repaired.

### Arclight Fabric 1.21.1

Evidence: `/tmp/voxellume-runtime-research/arclight-evidence` (`RESULT.json`, `commands.json`, `live-gates.json`, `scenario-report.json`, `artifacts/voxellume-arclight-d938774-in-world.png`). Exact checkout, Gradle distribution hash, Fabric build, real OpenGL client, isolated flat-world join, W movement of 4.175 blocks, in-world screenshot, and exact process/filesystem cleanup passed. The checked-in wrapper JAR required a documented official-Gradle 8.13 compatibility replacement; Loom `1.10-SNAPSHOT` remains non-immutable. `mc.world.leave` never produced a consistent `client.rawInWorld == false` within 60 seconds, so the complete scenario failed and no post-leave capture exists. Overall **failed qualification**, not `supported`. Fabric only; NeoForge was not run, and three attempts were not exceeded.

### ModLens vanilla 26.3

Evidence: `/tmp/voxellume-runtime-research/evidence/modlens-vanilla-26.3` (`summary.json`, `run-0YkPH3/qualification.json`, `artifact-hashes.json`). All seven live gates passed on macOS arm64: SDL launch, isolated demo-world creation, W movement of 5.157546 blocks with release acknowledgment, coordinate/screen assertion, real title/popup/in-game PNGs, exact process-group cancellation, and credential/process cleanup. This is **vanilla-only qualification**, not a loader or production-support claim. Node 26.10.0 is below the documented 26.12.1+ security floor; full npm build was unavailable under approved scopes, so runtime modules were selectively built without changing tracked source. World setup used measured SDL input because no native `create_world` exists, state inspection is limited to screen/flags/coordinates, and adapter stop still requires Voxellume supervisor cancellation.
