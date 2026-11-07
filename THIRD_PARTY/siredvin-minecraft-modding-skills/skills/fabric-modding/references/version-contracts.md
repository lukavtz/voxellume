# Fabric version contracts

## Version boundary

Read the exact target documentation and generated sources before copying names. Fabric ≤1.21.11 can use Yarn or Mojang mappings with remapping Loom. Fabric ≥26.1 uses official unobfuscated names, the non-remapping plugin, ordinary dependency configurations, normal `jar`, and `official` access-file namespaces. The compatibility wrapper used by an existing project is not evidence of misconfiguration.

Official sources:

- https://docs.fabricmc.net/develop/loom/ — plugin IDs and remapping versus non-remapping contracts.
- https://docs.fabricmc.net/26.1.2/develop/porting/ — pinned 26.1-line porting guide.
- https://docs.fabricmc.net/26.1.2/develop/porting/fabric-api — source-incompatible Fabric API changes beyond mappings.

The corresponding `/26.1/` documentation paths returned 404; use the observed patch-pinned paths above rather than constructing URLs from a Minecraft version.

## Verify the target build

- Read effective plugins, mappings, toolchains, source sets, and loader metadata rather than inferring them from directory names. Preserve existing multi-module and versioned configuration.
- Discover node-qualified tasks before execution; plugin application does not guarantee a client, server, datagen, or GameTest run exists.
- Build the affected targets and inspect production artifacts for the expected loader descriptor, expanded placeholders, and correct remapping/reobfuscation. Descriptor presence alone does not prove bytecode correctness.
- Report compilation, unit tests, GameTests, and client/server startup separately. Restore canonical source state after preprocessing and inspect the diff.
