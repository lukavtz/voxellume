## Structures And Fixtures

Specify `template` explicitly unless the generated `<SimpleClassName>.<methodName>` name is intentional. Keep SNBT resources in the location expected by the project's GameTest setup.

When generic testmod fixture commands are wired, use:

```text
/testiarium import
/testiarium export
/testiarium regen-structures
/testiarium marker
```

- `import` copies source fixtures into the runtime structures directory.
- `export` copies runtime structures back to the source directory.
- `regen-structures` imports, invokes vanilla structure export for registered tests, then exports files back.
- `marker` places or removes a named invisible armor stand used as a position/orientation marker.

Set both `testiarium.fixture-source` and `testiarium.structures` for these workflows. Synchronization overwrites files but does not delete stale destination files, so inspect both directories when a removed fixture still appears.

The testmod fills omitted SNBT positions with explicit air. The mixin target is version-specific:

- Minecraft 1.20.1 targets `StructureUtils` with `StructureUtilsMixin`.
- Minecraft 1.21.1 targets `StructureTemplateManager` with `StructureTemplateManagerMixin` and enables test-structure loading outside an IDE.

Include the matching mixin and `StructureTemplateAccessor` when relying on compact structures; this behavior is not part of the core production artifact. On Fabric consumers whose run only loads their own testmod, reference a local mixin config containing the appropriate Testiarium mixins.
