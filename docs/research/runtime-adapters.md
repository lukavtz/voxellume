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
