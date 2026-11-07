# Minecraft 1.21.x → 26.1 Migration Brief

Complete this before implementation. Use `Unknown — user decision required` instead of guessing about architecture, compatibility, public API, or release scope.

## 1. Repository baseline

- Repository/path:
- Current branch and dirty state:
- Exact Minecraft source version:
- Current loader(s) and versions:
- Exact target Minecraft patch:
- Target loader(s):
- Current Java / Gradle / build plugins:
- Current mappings namespace:
- Modules/source sets:
- Canonical/VCS source state and restoration command:
- Per-version overrides and generated/processed source roots:
- Maintained old nodes and target-only plugin/toolchain changes:
- Publication coordinates/artifacts:

## 2. Product and compatibility contract

- Mod role and key features:
- Supported physical sides:
- Legacy loader(s) to retain/drop:
- Existing saves/worlds that must load:
- Stable registry IDs:
- Config compatibility requirements:
- Datapack/resource-pack compatibility requirements:
- Network compatibility requirements:
- Public API/add-on compatibility requirements:
- Acceptable breaking changes and migration notes:

## 3. Architecture decisions

- Direct or staged port, and why:
- Branch/merge policy:
- Mapping migration plan:
- Common/loader module strategy:
- Client/common source-set policy:
- Loader abstraction approach:
- Temporary compatibility shims and deletion criteria:
- Optional integrations allowed to be deferred:

## 4. Feature inventory

| Area | Current implementation | Migration boundary/risk | Target design | Verification |
|---|---|---|---|---|
| Build/publication | | | | |
| Entry points/events | | | | |
| Registries | | | | |
| Components/persistence | | | | |
| Item/fluid/energy transfer | | | | |
| Networking | | | | |
| Resources/datagen | | | | |
| Rendering/GUI/models | | | | |
| Mixins/access/reflection | | | | |
| Loader adapters | | | | |
| Optional integrations | | | | |
| Tests/GameTests | | | | |

## 5. Data ownership decisions

For every persistent or synchronized value:

| Value | Owner/lifetime | Current format | Target mechanism | Codec/sync | Old-data migration |
|---|---|---|---|---|---|
| | | | | | |

Choose deliberately among data components, data attachments, global server `SavedData`, dimension-owned `SavedData`, codec-backed config, datapack registry, runtime-only state, an immutable `ItemStackTemplate` with registry-context-deferred component binding, and runtime `ItemStack`.

- Existing `SavedDataType` identifiers and world-relative file paths:
- Global data moving from overworld storage to `MinecraftServer#getDataStorage`:
- Dimension-owned data remaining level-scoped:
- File Fixer Upper or custom world-file move/delete operations:
- Mandatory backup and copied-world test procedure:
- Downgrade policy after world-layout migration:

## 6. Networking contract

| Payload | Phase | Direction | Buffer/codec | Handler side/thread | Server validation | Compatibility |
|---|---|---|---|---|---|---|
| | | | | | | |

## 7. Rendering classification

| Renderer | Category | Client-only boundary | Current API | Target extraction/submission/model API | Risk |
|---|---|---|---|---|---|
| | | | | | |

Categories: HUD/GUI, entity, block entity, level/world, baked/model loading, fluid, particle, direct GPU/OpenGL.

## 8. Ordered migration plan

- [ ] Baseline build/tests captured
- [ ] Intervening 1.21.x primer/release boundaries reviewed
- [ ] Mapping namespace migrated separately where applicable
- [ ] Clean 26.1.x build bootstrapped
- [ ] Mechanical name/API pass
- [ ] Registration/lifecycle
- [ ] Components/persistence/templates/transfers
- [ ] Networking
- [ ] Resources/datagen/test assets
- [ ] Rendering/GUI/models
- [ ] Loader adapters and optional integrations
- [ ] Publication/package inspection
- [ ] Stabilization and compatibility testing

## 9. Verification matrix

Record exact discovered task names and real expected outcomes.

| Gate | Loader/environment | Command or procedure | Required outcome / observed result / gaps |
|---|---|---|---|
| Clean build | | | |
| Unit/static tests | | | |
| Datagen + diff review | | | |
| GameTests | | | |
| Dedicated server | | | Ready signal, no client linkage |
| Client launch | | | Title screen + world join |
| New world smoke | | | |
| Old world upgrade copy | | | |
| Multiplayer/network abuse | | | |
| Required integrations | | | |
| Mixin bytecode/runtime | | | |
| Published JAR inspection | | | |

## 10. Approval gate

- User decisions still required:
- Assumptions safe enough to proceed:
- Explicitly deferred work:
- Definition of done:
- Approved to implement by:
- Approval date/reference:
