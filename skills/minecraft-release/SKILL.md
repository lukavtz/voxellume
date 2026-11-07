---
name: minecraft-release
description: Use when packaging verified Minecraft mods or Voxellume artifacts, proving clean installation, or preparing reviewed GitHub delivery.
---

# Minecraft release

Read [delivery requirements](../../docs/SPEC.md#47-deliver), [repository hygiene](../../docs/SPEC.md#10-repository-hygiene), and [release exit criteria](../../docs/TEST_PLAN.md#9-exit-criteria).

## Use when

A verified candidate needs an exact distributable package, clean-install evidence, checksums, or a reviewed commit, push, and pull request.

## Inputs

- Final `minecraft-verification` report, declared target/support matrix, and known limitations.
- Exact source/project revision, release version/tag, owned paths, and intended deliverable kind.
- License/provenance and SBOM inputs, package test environment, and separate trusted push/PR approvals.

## Procedure

1. **Admit verified input only.**
   - Reconcile every required acceptance and target-matrix row with finalized evidence, including the trusted human's approved visual-rubric record where required.
   - Failed, unrun, cancelled, timed-out, or unavailable required rows block release.
   - An `unsupported` target is admissible only when the declared matrix and primary-source reason already classify that cell as unsupported.
   - For declared Modrinth dependencies only, use `minecraft-modrinth` to recheck exact project/version IDs, loader/game compatibility, dependencies, filenames, sizes, and SHA-512 hashes. Download only when separately approved; perform no Modrinth writes or publication.
   - **Done:** every supported target's required evidence passes, each declared unsupported cell has reason evidence, and declared Modrinth artifacts have exact identity/hash records.
2. **Assemble only the matching allowlist.**

   | Deliverable      | Permitted payload                                                                                                                                                                                                                                      |
   | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
   | Generated mod    | One production JAR per declared target; source archive; editable assets and asset manifest; ModSpec; wrapper and lock/dependency-verification metadata; reproduction instructions; licenses/notices; SBOM/provenance; checksums.                       |
   | Voxellume plugin | Prebuilt JavaScript and declarations; declared exports and host entry points; `cordis.patch.yml`; skills/agents/commands; schemas, target packs, templates, and documentation indexes; licenses/notices; SBOM/provenance; checksums; support manifest. |
   - Keep the evidence bundle separate.
   - Exclude credentials, caches, logs, evidence worlds, test-only content, arbitrary install scripts, sources/dev/javadoc JARs, and ambiguous duplicate JARs.
   - For a tagged mod-JAR release, apply [Jahrome release selection](../../THIRD_PARTY/jahrome-minecraft-agent-skills/.agents/skills/minecraft-ci-release/SKILL.md) and its [version check](../../THIRD_PARTY/jahrome-minecraft-agent-skills/.agents/skills/minecraft-ci-release/references/publishing-gradle.md): tag equals `mod_version`, artifact-version conventions remain intact, exactly one primary JAR per target is selected, and no publisher is enabled.
   - **Done:** inspected contents exactly match the allowlist, all hashes are recorded, and license/secret findings are resolved.

3. **Prove the distributed artifact.**
   - Run the repository-declared formatting, lint, type, unit, integration, host-contract, security, target, packaging, and clean-install gates applicable to the deliverable against the exact JAR/tarball, not merely the checkout.
   - Exercise each claimed OMP/DSH installation and the normalized reproducibility comparison.
   - **Done:** the final artifact passes every declared gate and its documentation matches observed behavior and unqualified targets.
4. **Deliver through reviewed Git operations.**
   - Record base branch, remote, and owned paths; stage only reviewed paths and create one focused commit.
   - Obtain separate trusted approval before push and again before PR creation. Keep merges and destructive history operations outside this workflow.
   - Record remote SHA, PR URL, checks, and evidence links; report partial external failure as actual state without claiming rollback.
   - **Done:** the reviewed commit and any approved external mutations have verified identities and visible results.
5. **Close the candidate.**
   - Check all applicable [exit criteria](../../docs/TEST_PLAN.md#9-exit-criteria), including required visual review.
   - **Done:** the PR or release handoff contains exact artifact hashes, clean-install evidence, limitations, and no support claim beyond the verified matrix.

## Output

Return artifact/checksums, separate evidence, clean-install/reproducibility results, and GitHub state. Missing gates or approvals block publication and release claims.
