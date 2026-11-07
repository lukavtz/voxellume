---
name: neoforge-modding
description: Develop NeoForge mods with version-matched APIs.
license: MIT
metadata:
  version: "1.1.0"
  author: "minecraft-modding-skills contributors"
---

# NeoForge Modding

Use this skill to implement or review Minecraft mods targeting NeoForge. Prefer project-local versions, mappings, Gradle plugins, and existing conventions over generic examples. When behavior depends on a specific Minecraft or NeoForge version, verify against the matching page on `https://docs.neoforged.net/` before coding.

## First Checks

- Confirm the Minecraft and NeoForge versions from `gradle.properties`, `build.gradle`, `settings.gradle`, or generated MDK files.
- Confirm the mod id, package, and Java version: 1.20.1 uses Java 17, 1.21.x Java 21, and 26.1 Java 25. Do not infer loader or version from a directory named `forge`.
- Read [version contracts and inspected projects](references/version-contracts.md) before copying current-doc APIs into 1.21.1. Resolve actual source roots, metadata expansion, and node-qualified tasks through settings/build/convention plugins.
- Prefer the generated Gradle workflow: `./gradlew build`, `./gradlew runClient`, `./gradlew runServer`, and datagen runs configured by the project.
- Reload Gradle after changing Gradle files; avoid editing `build.gradle`/`settings.gradle` when `gradle.properties` is sufficient.
- Always test server safety for common code, even for client-focused mods.

## Project Structure

- Keep common code free of `net.minecraft.client` imports.
- Put client-only setup behind physical-client gates: a client-only event subscriber, or a separate `@Mod(value = MOD_ID, dist = Dist.CLIENT)` class **where the target FML supports it**. Older targets need their matching subscriber annotation/bus syntax.
- Use `src/main/java` for code, `src/main/resources/assets/<modid>` for client assets, and `src/main/resources/data/<modid>` for gameplay data.
- Use generated resources under `src/generated/resources` when the Gradle project is configured for datagen.
- Keep registration classes small and grouped by registry type, e.g. `ModItems`, `ModBlocks`, `ModCreativeTabs`.

## Registration

- Prefer `DeferredRegister` over raw `RegisterEvent` unless the project needs low-level control.
- Create one deferred register per registry and attach it to the mod event bus in the mod constructor.
- Store registered objects as `Supplier<T>`, `DeferredHolder<R, T>`, `DeferredItem<T>`, or `DeferredBlock<T>` according to the API expected by surrounding code.
- Do not instantiate registry objects outside registration; blocks, items, entities, tabs, data components, and similar entries must be singleton registry entries.
- Use the mod id namespace for every custom `Identifier`/resource location and keep registry names lowercase snake_case.

Official 1.21.1 item-helper shape (also prefer ID-supplying helpers on later targets):

```java
public static final DeferredRegister.Items ITEMS = DeferredRegister.createItems(MOD_ID);
public static final Supplier<Item> EXAMPLE_ITEM = ITEMS.registerSimpleItem("example_item");

public ExampleMod(IEventBus modBus) {
    ModItems.ITEMS.register(modBus);
}
```

## Items And Blocks

- From 1.21.2, item/block properties require IDs; use loader helpers that supply them, or set them explicitly before construction. Do not copy `Item.Properties#setId` into 1.21.1, where it does not exist. Configure supported behavior through properties/components.
- Treat `ItemStack` as mutable; call `copy()` or `copyWithCount()` before mutating stacks that may be shared or treated as immutable.
- For blocks, use `DeferredRegister.createBlocks(MOD_ID)`; on ID-requiring targets use a helper that supplies the key or `BlockBehaviour.Properties#setId` before construction.
- Register a matching `BlockItem` if a block must appear in inventories or be placeable by players.
- Add items to existing creative tabs with `BuildCreativeModeTabContentsEvent`; register custom `CreativeModeTab` entries through a deferred register.
- Put models, blockstates, item models, lang entries, recipes, tags, and loot tables in assets/data or datagen providers instead of hardcoding them.

## Events

- Register game events on `NeoForge.EVENT_BUS`; register mod lifecycle/registry/setup/datagen/network payload events on the mod event bus.
- Event handlers must be `void` methods with a single event parameter.
- Use `IEventBus#addListener`, `@SubscribeEvent`, or `@EventBusSubscriber(modid = MOD_ID)` consistently with the project style.
- Do not subscribe to abstract event classes such as base `LivingEvent`, `PlayerEvent`, or `BlockEvent`; subscribe to concrete subevents.
- For cancellable events, use `setCanceled` only when cancellation is documented for that event; for tri-state/result events, prefer the event’s explicit result setter.
- For parallel lifecycle events, use `event.enqueueWork(...)` when work must run on the main thread.

## Sides

- Use `level.isClientSide()` for logical-side game logic decisions; run authoritative gameplay logic only when it is `false`.
- Use the target FML physical-side API (`FMLEnvironment.dist` on 1.21.1; newer versions may expose `getDist()`) and gated client classes. Neither a logical-side branch nor an ungated common static reference is safe isolation.
- Never assume singleplayer means server-only code can touch client classes; singleplayer has both a logical client and logical server inside a physical client.
- Transfer state between logical sides with networking payloads, not static fields.
- Run `runServer` or a dedicated-server test path to catch `NoClassDefFoundError` from client-only imports.

## Networking

- Register custom payloads during `RegisterPayloadHandlersEvent` on the mod event bus using `event.registrar("<protocol-version>")`.
- Implement payloads as `CustomPacketPayload` records/classes with a unique `Type` and a `StreamCodec`.
- Choose `playToServer`, `playToClient`, or `playBidirectional` according to direction. On 1.21.1 handlers are supplied to the registrar (bidirectional handlers can use `DirectionalPayloadHandler`); current 26.1 uses `RegisterClientPayloadHandlersEvent` for client handlers. Keep their implementation physically client-only in either case.
- Keep gameplay handlers on the main thread by default. `HandlerThread.NETWORK` changes execution context; it is not an unbounded worker pool. Bound parsing/work, never block network I/O with expensive computation, and use `IPayloadContext#enqueueWork` for game state with exception handling.
- Validate serverbound permissions, distances, counts, identifiers, and loaded-chunk/entity existence; do not load arbitrary chunks on client request.
- On 1.21.1 use `PacketDistributor.sendToServer`; on current 26.1 use `ClientPacketDistributor.sendToServer` in client-only code. Server-to-client sends use `PacketDistributor` helpers.
- Respect payload size limits: clientbound payloads are at most 1 MiB, serverbound payloads are less than 32 KiB.

## Resources And Datagen

- Put client resources under `assets/<modid>` and server data under `data/<modid>`.
- Remember NeoForge generates built-in resource/data packs for mods and modern NeoForge handles `pack.mcmeta` at runtime.
- Use vanilla and NeoForge external resources in the IDE as the source of truth for JSON formats.
- Prefer datagen for repetitive or fragile JSON: models, blockstates, lang, tags, recipes, loot tables, sounds, particles, data maps, and datapack registries.
- On 1.21.1 register providers from `GatherDataEvent` with the appropriate include flags. Later versions split gathering into `GatherDataEvent.Client`/`Server`; inspect the exact target provider helpers and configured runs rather than backporting current examples.
- Use `RegistrySetBuilder` and `BootstrapContext` for datapack registry entries that need generated JSON.

## Validation Checklist

- Run the narrowest relevant Gradle task first, then `./gradlew build` if practical.
- Run client and dedicated-server paths when touching sides, events, networking, rendering, or resources.
- Verify generated JSON is included in the resource output and checked for namespace/path correctness.
- Check logs for missing models, missing translations, registry freeze errors, packet version mismatches, and client-only class loading on server.
- When unsure about an API, inspect existing project usage and the matching NeoForge docs version before inventing patterns.

## Official References

- Main docs: `https://docs.neoforged.net/`
- Getting started: `https://docs.neoforged.net/docs/gettingstarted/`
- Registries: `https://docs.neoforged.net/docs/concepts/registries/`
- Events: `https://docs.neoforged.net/docs/concepts/events/`
- Sides: `https://docs.neoforged.net/docs/concepts/sides/`
- Items: `https://docs.neoforged.net/docs/items/`
- Blocks: `https://docs.neoforged.net/docs/blocks/`
- Resources and datagen: `https://docs.neoforged.net/docs/resources/`
- Networking payloads: `https://docs.neoforged.net/docs/networking/payload/`
