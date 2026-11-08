# Voxellume CI workflows

Date: 2026-11-08.

## Trust and reproducibility contract

All six workflows set only `permissions: contents: read`. No workflow uses `pull_request_target`, references repository secrets, publishes a release, or grants generated Gradle code credentials. Every third-party action is pinned to a 40-character commit SHA. `scripts/ci/validate-workflows.mjs` checks those invariants and the required gate commands; run it with:

```sh
node scripts/ci/validate-workflows.mjs
```

The pinned runtime/tool versions are Node `24.9.0`, pnpm `12.18.0` through Corepack, Bun `1.4.4`, Python `3.12.12`, Temurin JDK `21`/`25`, Gitleaks `8.30.1`, Semgrep `1.183.0`, OSV-Scanner `2.7.0`, and CycloneDX cdxgen `12.9.1`. `scripts/ci/install-security-tools.sh` downloads Linux amd64/arm64 binaries over TLS and verifies SHA-256 before execution. Gitleaks and OSV-Scanner hashes are fixed in the script; cdxgen is checked against its versioned release checksum. Semgrep is installed into an isolated virtual environment at an exact version.

Fast static/package jobs use GitHub-hosted Ubuntu. Core unit/integration and adversarial tests run on Ubuntu, macOS, and Windows x64. Java target cells and release/GPU jobs are separate from the fast quality gate. Runtime jobs accept only a GitHub-hosted runner named by `VOXELLUME_GPU_RUNNER`; persistent self-hosted runners are not supported for untrusted mod code. A configured runner must expose `nvidia-smi`. There are no PR triggers on the GPU workflow.

## Workflows and exact checks

| Workflow             | Triggers                                        | Checks                                                                                                                                                                                                                                              | Evidence                                                                                                   |
| -------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `quality.yml`        | PR/main/dispatch                                | `validate-workflows.mjs`; `pnpm format:check`; `pnpm lint`; `pnpm typecheck`; `pnpm test:unit`; `pnpm test:integration`                                                                                                                             | Validation/format/lint/type/test logs, 14 days                                                             |
| `host-contract.yml`  | Host/package changes, main, dispatch            | `pnpm test:host`; two real packs and normalized inventory comparison; SHA-256 verification; isolated OMP install/list/uninstall; isolated DSH add/`--dump-config`/remove with install scripts disabled                                              | Host tests, package inventory/provenance, install logs/config, 14 days                                     |
| `security.yml`       | PR/main/weekly/dispatch                         | `pnpm test:security` on Ubuntu, macOS, and Windows x64; Gitleaks full-history scan; local Semgrep rules with `--metrics=off`; read-only OSV lockfile scan; CycloneDX SBOM; `pnpm licenses list --json --long`; report shape and checksum assertions | Adversarial logs, scan reports, SBOM, license inventory, `SHA256SUMS`, 30 days                             |
| `target-matrix.yml`  | Affected target/shared paths, nightly, dispatch | `pnpm test:targets`; exact affected-cell selection; all 68 cells nightly; JDK 21/25 identity; per-cell status evidence                                                                                                                              | Plan, catalog log, per-cell result and `SHA256SUMS`, 30 days                                               |
| `runtime-visual.yml` | `v*-rc.*` tags/dispatch                         | Supported-cell discovery; GitHub-hosted GPU and `nvidia-smi` preflight; JDK-specific runtime evidence boundary                                                                                                                                      | Plan, GPU identity, per-JDK result, 30 days                                                                |
| `release.yml`        | Version tags/dispatch                           | `pnpm verify`; support-manifest and evidence validation; nonzero-supported release gate; two packs; byte or normalized reproducibility; exact tarball SHA-256; repeated security gate; clean OMP/DSH installation                                   | Readiness status, tarball, checksums, package inventory, provenance, security and install reports, 30 days |

`release-artifact.mjs` first requires byte-identical tarballs. If gzip/tar metadata differs, it accepts the pack only when sorted relative paths, executable modes, and every file SHA-256 are identical. The result explicitly records `byteIdentical` and `normalizedIdentical`; it never calls reproduction instructions alone proof. `provenance.json` binds the package name/version, Git revision, artifact hash, package/lock/support-manifest hashes, target statuses, and tool versions. This is unsigned CI provenance, not an OIDC signature or independent attestation.

## Current evidence boundary

The catalog currently has **52 `candidate`, 15 `rejected`, 1 `unsupported`, and 0 `supported` packs**. Candidate, rejected, and unsupported cells produce explicit non-success evidence with `checked=false`; they never create success artifacts or execute qualification commands. The release workflow therefore stops at `Release blocked: catalog has zero supported target packs` and preserves `support-status.json`.

No fresh server/client/GameTest/production-JAR/visual executor is currently wired into these workflows. `target-cell.mjs` fails closed if a pack becomes `supported` without that executor; archived evidence is not accepted as a fresh CI pass. Consequently the GPU workflow currently records no supported work rather than claiming a runtime or visual pass. A future runtime executor must run the pack's allowlisted argv in the mandatory sandbox and collect behavior, production-JAR, real-client, screenshot, and human-review evidence before this limitation can be removed.

Host tests and clean installs are model-independent. They do not prove a model-backed interactive scenario. Live OMP/DSH model evaluation remains separately credentialed and must be labeled model-backed; CI does not supply model credentials. Windows x64 native probes are exercised by quality/security CI. Windows ARM64 native probes remain unexecuted and unverified, as recorded in `docs/TEST_PLAN.md`.

## Local deterministic checks

```sh
node scripts/ci/validate-workflows.mjs
node scripts/ci/target-cell.mjs plan
node scripts/ci/target-cell.mjs cell --pack java-fabric-1.21.1-r2
node scripts/ci/release-artifact.mjs
```

The release command without `--require-supported` verifies the current package and support manifest without declaring release readiness. The tagged/manual release workflow always uses `--require-supported`.
