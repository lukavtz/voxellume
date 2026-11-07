# NeoForge version contracts

## Do not backport current documentation verbatim

For 1.21.1, use the matching API: `registerSimpleItem`, `FMLEnvironment.dist`, registrar-supplied payload handlers, `PacketDistributor.sendToServer`, and unsplit `GatherDataEvent`. Later item/block property IDs, client payload-handler events, physical-side accessors, and split datagen events are separate version boundaries. Inspect exact target sources for signatures and subscriber syntax.

Official source map:

- https://docs.neoforged.net/docs/1.21.1/items/ — version-matched item registration.
- https://docs.neoforged.net/docs/1.21.1/networking/payload/ — payload registration and handler threading.
- https://docs.neoforged.net/docs/1.21.1/resources/ — older datagen contract.
- https://neoforged.net/news/21.2release/ — item/block ID boundary.
- https://docs.neoforged.net/docs/networking/payload/ — current API, not a 1.21.1 recipe.
- https://neoforged.net/news/26.1release/ — Java 25 and 26.1 migration context.

## Verify the target build

- Read effective plugins, mappings, toolchains, source sets, and loader metadata rather than inferring them from directory names. Preserve existing multi-module and versioned configuration.
- Discover node-qualified tasks before execution; plugin application does not guarantee a client, server, datagen, or GameTest run exists.
- Build the affected targets and inspect production artifacts for the expected loader descriptor, expanded placeholders, and correct remapping/reobfuscation. Descriptor presence alone does not prove bytecode correctness.
- Report compilation, unit tests, GameTests, and client/server startup separately. Restore canonical source state after preprocessing and inspect the diff.
