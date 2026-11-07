## Optional CC:Tweaked Harness

CC:Tweaked support is test-only and version-sensitive. Put CCT-dependent code and matching loader dependencies in a dedicated test source set. Do not introduce CC:Tweaked into Testiarium core or ordinary runtime classpaths.

Initialize the CCT harness before CC:Tweaked creates its server context, then reset state and import fixtures on every server start:

```kotlin
CctComputers.initialize()

ServerLifecycleEvents.SERVER_STARTING.register { server ->
    CctComputers.reset()
    CctFixtureCommands.importFiles(server)
}

Testiarium.register(ComputerGameTests::class.java)
FabricTestiarium.registerTests()
```

Use equivalent Forge or NeoForge lifecycle events in the matching testmod. Initialization globally replaces CC:Tweaked's Lua machine factory for that process, so do it only in the CCT test environment.

Sequence helpers:

- `thenStartComputer(name, action)` starts a Kotlin computer action without waiting.
- `thenOnComputer(name, action)` starts an action, waits, and propagates failure.
- `thenComputerOk(name, marker)` waits for a Lua completion marker.
- `helper.thenLua(label)` waits for the fixture computer to signal the default `DONE` marker.

Example Lua-driven test:

```kotlin
@TestGroup("example-cct")
class ComputerGameTests {
    @GameTest(template = "computergametests.peripheral")
    fun peripheral(helper: GameTestHelper) = helper.thenLua().thenSucceed()
}
```

The default `thenLua` label is the structure name. Kotlin action helpers instead derive labels from `<TestClass>.<method>` plus an optional suffix. Label fixture computers deliberately and ensure `tests/<label>.lua` exists beneath `testiarium.cct-fixtures`.

Lua tests communicate through:

```lua
test.log("diagnostic")
test.ok()          -- DONE marker
test.ok("phase-1")
test.fail("reason")
```

CCT fixture commands are:

```text
/testiarium cct import
/testiarium cct export
/testiarium cct give-computer <item>
```

The built-in fixture synchronization targets CC:Tweaked computer directory `1`. Check world state and computer IDs if imported files are ignored.

CC:Tweaked computers execute asynchronously while a GameTest server advances ticks as fast as possible. On the 1.21 port, CCT runs include Testiarium's `GameTestServerMixin`, which waits for the CC computer scheduler between ticks. Match the reflection bridge to the configured CC:Tweaked version: 1.113 exposes queue, worker-count, and idle-worker internals, while newer CC:Tweaked branches provide `ComputerThread.isFullyIdle()`. Never copy this internal integration between Testiarium versions without checking the matching CC:Tweaked source.


Unlike `helper.sequence {}`, `helper.thenLua()` returns an unfinished `GameTestSequence`; append `.thenSucceed()` once after the Lua completion/failure checks. The pinned Tweakium consumer uses exactly this terminal step.
