export interface CollectArtifactsInput {
  readonly projectRoot: string;
  readonly logPath?: string;
  readonly serverStatus?: string;
  readonly outDir?: string;
  readonly pinId?: string;
}

export interface LiveArtifacts {
  readonly pinId: string;
  readonly jarSha256: string;
  readonly jarBytes: number;
  readonly serverStatus: string;
  readonly logPaths: readonly string[];
  readonly outDir: string;
  readonly jarPath: string;
}

export function collectArtifacts(
  input: CollectArtifactsInput,
): Promise<LiveArtifacts>;
