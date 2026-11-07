## Automated Client Tests

Use `@ClientGameTest` for tests that require a real client:

```kotlin
@ClientGameTest(template = "empty", timeoutTicks = Timeouts.SECOND * 20)
@TestGroup(TestTags.CLIENT)
fun opensScreen(helper: GameTestHelper) = helper.sequence {
    thenOnClient {
        check(minecraft.player != null)
    }
    thenScreenshot("opens-screen", showGui = true)
}
```

Available client sequence helpers include:

- `thenOnClient { ... }`: schedules work on the Minecraft client thread.
- `thenRenderIdle(ticks)`: waits until rendering remains stable.
- `thenScreenshot(name, showGui)`: waits for stable rendering and captures a PNG.
- `positionAt(pos, yRot, xRot)` and `positionAtArmorStand()`: position the player for visual interaction.
- `ClientTestHelper.getOpenMenu(type)`: assert and return the currently open menu.

The automated runner creates or reuses a `testiarium-client` flat world, waits for stable rendering, finishes reports, and exits. Exit code 1 means no tests ran; exit code 2 means a required test failed. Minecraft 1.20 uses `runTestBatches`/`groupTestsIntoBatches`; Minecraft 1.21 uses `GameTestRunner.Builder`, `GameTestBatchFactory`, and `StructureGridSpawner` near the shared spawn.

Client GameTests require graphics even in automation. Check the selected JDK, `timeout`, `xvfb-run`, Xvfb, `xauth`, and working OpenGL/Mesa drivers before launching on Linux. A virtual display alone does not provide a usable graphics driver; diagnose GLFW/OpenGL startup errors separately from test failures. Provision dependencies through the runner image or an approved package installation, not by silently changing the host.

Discover the exact node task, then bound the complete run:

```bash
command -v timeout xvfb-run Xvfb xauth
./gradlew :testiarium:fabric:1.21.1:tasks --all
timeout --foreground --kill-after=30s 180s xvfb-run --auto-servernum \
  ./gradlew :testiarium:fabric:1.21.1:runClientGameTest --no-daemon
```

The same task suffix is configured on the pinned Forge-family nodes. The 180-second budget is an example for a prepared checkout, not a measured guarantee for cold downloads, asset generation, or software rendering. Keep a finite outer deadline; raise it deliberately after identifying startup versus test time. `timeoutTicks` limits a running test, not Gradle startup, world loading, or waiting for stable rendering.

- Preserve the shell exit status: GNU timeout normally returns 124 on deadline expiry, while forced kills may report 137. Those are infrastructure/incomplete runs, not Testiarium assertion codes.
- The game process exits 1 for no tests or 2 for required failures; Gradle may wrap either in its own generic nonzero task exit. Read game logs and XML rather than interpreting the Gradle exit code as the game's code.
- Use a dedicated run directory/world, not a user's gameplay world: the runner reuses `testiarium-client`, changes options, teleports players, and clears inventory.
- `thenScreenshot` defaults to `showGui=false`; use `thenScreenshot("opens-screen", showGui = true)` for UI evidence. A captured image is not an assertion that synchronization, narration, or rejection behavior works.
- Store a fresh per-run report path or verify report timestamps and testcase names. Require expected tests to be present and required failures to be absent; a stale XML, an all-skipped suite, or zero tests is not a pass.
- Capture logs and reports on failure, including timeout. Reports finalize only during orderly completion; a missing report after termination is an incomplete result. Check for surviving Minecraft/Xvfb child processes after forced cleanup rather than assuming a wrapper exit killed every descendant.

Keep client hook registration physically client-only. On Forge 1.20 use `DistExecutor` or an equivalent safe boundary. On NeoForge 1.21 check `FMLEnvironment.dist == Dist.CLIENT` before touching client hooks. On Fabric use a `client` entrypoint. Never load client helper classes on a dedicated server.
