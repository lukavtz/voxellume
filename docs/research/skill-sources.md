# Ready-made Minecraft skill evaluation

Date: 2026-11-07. Sources were evaluated from primary repositories, not install counts alone.

## Selected references

| Source                              | Reviewed revision                          | Use in Voxellume                                                                                                                                      |
| ----------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rehan-remade/universal-modder`     | `3c4ac6c38e411b8c543bce217eae197039516bfc` | Vertical-slice recon, porting/adaptation matrix, editable assets, real-game scenarios, offline/game-worker split. MIT.                                |
| `SirEdvin/minecraft-modding-skills` | `b8e1133597d08eb41ac0d00d5d9555af8c1ba895` | Fabric/NeoForge project-local API checks, 1.21.x→26.1 migration gates, Testiarium rules only when already configured, Modrinth read/hash checks. MIT. |
| `Jahrome907/minecraft-agent-skills` | `22d61ce6b7a0c5f215008824aa6b94ecc73f2a43` | Loader test taxonomy, GameTest layouts, resource-pack cross-reference rules, release-version and single-primary-JAR checks. MIT.                      |
| `adhi-jp/agent-skills` workbench    | `16613367d14423aa5eca4bb83a42a5a4176df0c6` | Evidence levels, project profiles, build-is-not-runtime-proof, GameTest wiring, mappings-before-lifecycle porting. MIT.                               |

These sources remain behind the seven `skills/minecraft-*` workflows. They do not replace exact target packs, source/asset manifests, evidence schemas, or production-JAR gates. No source supplies Quilt coverage, the complete Forge 1.21+ matrix, editable Blockbench/provenance coverage, or the full release evidence bundle.

## Rejected or narrowly scoped sources

- `mrquentin/minecraft-skills`: no verifiable license file, hardcoded old ModDevGradle/NeoForge versions, Bedrock-only GameTest material. Not vendored.
- `github/awesome-copilot` `minecraft-plugin-development`: Bukkit/Paper/Spigot server plugins, outside Java mod targets. Not vendored.
- Jahrome `minecraft-multiloader`: Architectury setup rather than one-source porting and no Quilt/Forge coverage. Only naming/version-boundary ideas are relevant.
- Adhi workbench MCP recipes: require the disabled source facade and a different tool/result contract. Only source-agnostic methods are adapted.

## Explicit exclusions

- Jahrome's `eula = true` snippets are never copied; EULA approval remains a separate environment grant.
- Stale `build/libs/*.jar` discovery, host-wide Gradle scripts, bash-4-only validators, and unverified action SHAs are not execution authorities.
- Testiarium and Stonecutter are not added as dependencies. Their workflow rules apply only to projects that already declare those tools.
- Install counts and repository stars do not establish correctness. Every adopted method remains subordinate to the exact target pack and executable verification.
