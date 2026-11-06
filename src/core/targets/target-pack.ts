export const TARGET_PACK_SCHEMA_VERSION = "target-pack-1.0.0";
export const TARGET_DOCS_SCHEMA_VERSION = "target-docs-1.0.0";
export const TARGET_VERIFICATION_SCHEMA_VERSION = "target-verification-1.0.0";

export const TARGET_PACK_STATUSES = [
  "draft",
  "candidate",
  "supported",
  "legacy",
  "rejected",
  "unsupported",
] as const;
export type TargetPackStatus = (typeof TARGET_PACK_STATUSES)[number];

export const TARGET_UNSUPPORTED_REASON_CODES = [
  "unknown_minecraft_release",
  "unknown_loader",
  "no_qualified_pack",
  "loader_release_unavailable",
  "api_unavailable",
  "mappings_unavailable",
  "toolchain_unavailable",
  "verification_failed",
] as const;
export type TargetUnsupportedReasonCode =
  (typeof TARGET_UNSUPPORTED_REASON_CODES)[number];

export const TARGET_CAPABILITIES = [
  "build",
  "server",
  "client",
  "gameTest",
  "visual",
] as const;
export type TargetCapability = (typeof TARGET_CAPABILITIES)[number];

export const ALLOWED_GRADLE_TASKS = [
  "clean",
  "build",
  "test",
  "runServer",
  "runClient",
  "runGameTestServer",
  "runClientGameTest",
  "runGametest",
] as const;
export type AllowedGradleTask = (typeof ALLOWED_GRADLE_TASKS)[number];

export type TargetLoader = "fabric" | "neoforge" | "forge" | "quilt";
export type TargetObfuscation = "obfuscated" | "unobfuscated";
export type TargetMappingKind =
  "yarn" | "mojang" | "quilt" | "parchment-layer" | "none";

export interface TargetReasonEvidence {
  readonly url: string;
  readonly sha256: string;
}

export interface TargetReason {
  readonly code: TargetUnsupportedReasonCode;
  readonly detail: string;
  readonly evidence: readonly TargetReasonEvidence[];
}

export interface TargetMinecraft {
  readonly version: string;
  readonly releaseManifestUrl: string;
  readonly releaseJsonUrl: string;
  readonly releaseJsonSha256: string;
  readonly obfuscation: TargetObfuscation;
  readonly dataPackVersion: number | string;
  readonly resourcePackVersion: number | string;
}

export interface TargetArtifact {
  readonly coordinates: string;
  readonly version: string;
  readonly artifactSha256: string;
}

export interface TargetApiDependency extends TargetArtifact {
  readonly id: string;
}

export interface TargetLoaderDefinition {
  readonly id: TargetLoader;
  readonly version: string | null;
  readonly coordinates: string | null;
  readonly artifactSha256: string | null;
  readonly apiDependencies: readonly TargetApiDependency[];
}

export interface TargetMappings {
  readonly kind: TargetMappingKind;
  readonly artifacts: readonly TargetArtifact[];
}

export interface TargetJava {
  readonly gradleJvm: number;
  readonly toolchain: number;
  readonly release: number;
  readonly architecture: "64-bit";
}

export interface TargetGradlePlugin {
  readonly id: string;
  readonly version: string;
}

export interface TargetGradle {
  readonly version: string;
  readonly distributionUrl: string;
  readonly distributionSha256: string;
  readonly plugins: readonly TargetGradlePlugin[];
}

export interface TargetTemplate {
  readonly repository: string;
  readonly revision: string;
  readonly path?: string;
  readonly contentSha256: string;
}

export interface TargetResources {
  readonly modelFormat: string;
  readonly blockbench: {
    readonly projectFormat: string;
    readonly applicationVersion: string;
  };
}

export interface TargetDocsReference {
  readonly url: string;
  readonly revision: string;
  readonly responseSha256: string;
}

export interface TargetApiDocs extends TargetDocsReference {
  readonly name: string;
}

export interface TargetGradlePluginDocs extends TargetDocsReference {
  readonly id: string;
  readonly version: string;
}

export interface TargetCatalogDocs {
  readonly url: string;
  readonly responseSha256: string;
}

export interface TargetDocs {
  readonly schemaVersion: typeof TARGET_DOCS_SCHEMA_VERSION;
  readonly retrievedAt: string;
  readonly minecraftRelease: TargetDocsReference;
  readonly loaderApi: readonly TargetApiDocs[];
  readonly gradlePlugins: readonly TargetGradlePluginDocs[];
  readonly catalogs: readonly TargetCatalogDocs[];
}

export interface TargetVerificationCheck {
  readonly argv: readonly string[];
  readonly assertions: readonly string[];
  readonly artifactGlobs: readonly string[];
}

export interface TargetEvidenceManifest {
  readonly path: string;
  readonly sha256: string;
}

export interface TargetVerification {
  readonly schemaVersion: typeof TARGET_VERIFICATION_SCHEMA_VERSION;
  readonly capabilities: Readonly<Partial<Record<TargetCapability, boolean>>>;
  readonly required: readonly TargetCapability[];
  readonly checks: Readonly<
    Partial<Record<TargetCapability, TargetVerificationCheck>>
  >;
  readonly testedPlatforms: readonly {
    readonly os: string;
    readonly arch: string;
  }[];
  readonly evidenceManifest?: TargetEvidenceManifest;
}

/** Aggregate of target.json, docs.json, and verification.json. */
export interface TargetPack {
  readonly schemaVersion: typeof TARGET_PACK_SCHEMA_VERSION;
  readonly id: string;
  readonly edition: "java";
  readonly status: TargetPackStatus;
  readonly reason?: TargetReason;
  readonly revision: number;
  readonly packSha256: string;
  readonly minecraft: TargetMinecraft;
  readonly loader: TargetLoaderDefinition;
  readonly mappings: TargetMappings;
  readonly java: TargetJava;
  readonly gradle: TargetGradle | null;
  readonly template?: TargetTemplate;
  readonly metadata: { readonly file: string };
  readonly resources: TargetResources;
  readonly knownLimitations: readonly string[];
  readonly docs: TargetDocs;
  readonly verification: TargetVerification;
}
