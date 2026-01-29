import path from 'path';

import fs from 'fs-extra';
import {
  ManagedArtifactType,
  BuildPhase,
  BuildPhaseResult,
  BuildPhaseStats,
  Job,
  LogMarker,
  Env,
  errors,
  Metadata,
  EnvironmentSecretType,
  GenericArtifactType,
  isGenericArtifact,
} from '@expo/eas-build-job';
import { ExpoConfig } from '@expo/config';
import { bunyan } from '@expo/logger';
import { BuildTrigger } from '@expo/eas-build-job/dist/common';
import { Client, fetchExchange } from '@urql/core';

import { PackageManager, resolvePackageManager } from './utils/packageManager';
import { resolveBuildPhaseErrorAsync } from './buildErrors/detectError';
import { readAppConfig } from './utils/appConfig';
import { createTemporaryEnvironmentSecretFile } from './utils/environmentSecrets';

export type Artifacts = Partial<Record<ManagedArtifactType, string>>;

export interface CacheManager {
  saveCache(ctx: BuildContext<Job>): Promise<void>;
  restoreCache(ctx: BuildContext<Job>): Promise<void>;
}

export interface LogBuffer {
  getLogs(): string[];
  getPhaseLogs(buildPhase: string): string[];
}

export type ArtifactToUpload =
  | {
      type: ManagedArtifactType;
      paths: string[];
    }
  | {
      type: GenericArtifactType;
      name: string;
      paths: string[];
    };

export interface BuildContextOptions {
  workingdir: string;
  logger: bunyan;
  logBuffer: LogBuffer;
  env: Env;
  cacheManager?: CacheManager;
  uploadArtifact: (spec: { artifact: ArtifactToUpload; logger: bunyan }) => Promise<
    /** Workflow Artifact ID */
    | { artifactId: string | null; filename?: never }
    /** This remains from the time we relied on Launcher to rename the GCS object. */
    | { artifactId?: never; filename: string | null }
  >;
  reportError?: (
    msg: string,
    err?: Error,
    options?: { tags?: Record<string, string>; extras?: Record<string, string> }
  ) => void;
  reportBuildPhaseStats?: (stats: BuildPhaseStats) => void;
  skipNativeBuild?: boolean;
  metadata?: Metadata;
}

export class SkipNativeBuildError extends Error {}

export class BuildContext<TJob extends Job = Job> {
  public readonly workingdir: string;
  public logger: bunyan;
  public readonly logBuffer: LogBuffer;
  public readonly cacheManager?: CacheManager;
  public readonly reportError?: (
    msg: string,
    err?: Error,
    options?: { tags?: Record<string, string>; extras?: Record<string, string> }
  ) => void;
  public readonly skipNativeBuild?: boolean;
  public artifacts: Artifacts = {};

  private readonly _isLocal: boolean;

  private _env: Env;
  private _job: TJob;
  private _metadata?: Metadata;
  private readonly defaultLogger: bunyan;
  private readonly _uploadArtifact: BuildContextOptions['uploadArtifact'];
  private buildPhase?: BuildPhase;
  private buildPhaseSkipped = false;
  private buildPhaseHasWarnings = false;
  private _appConfig?: ExpoConfig;
  private readonly reportBuildPhaseStats?: (stats: BuildPhaseStats) => void;
  public readonly graphqlClient: Client;

  constructor(job: TJob, options: BuildContextOptions) {
    this.workingdir = options.workingdir;
    this.defaultLogger = options.logger;
    this.logger = this.defaultLogger;
    this.logBuffer = options.logBuffer;
    this.cacheManager = options.cacheManager;
    this._uploadArtifact = options.uploadArtifact;
    this.reportError = options.reportError;

    this._job = job;
    this._metadata = options.metadata;
    this.skipNativeBuild = options.skipNativeBuild;
    this.reportBuildPhaseStats = options.reportBuildPhaseStats;

    const environmentSecrets = this.getEnvironmentSecrets(job);
    this._env = {
      ...options.env,
      ...job?.builderEnvironment?.env,
      ...environmentSecrets,
      __EAS_BUILD_ENVS_DIR: this.buildEnvsDirectory,
    };

    this._env.PATH = this._env.PATH
      ? [this.buildExecutablesDirectory, this._env.PATH].join(':')
      : this.buildExecutablesDirectory;

    this._isLocal = this._env.EAS_BUILD_RUNNER !== 'eas-build';

    this.graphqlClient = new Client({
      url: new URL('graphql', this.env.__API_SERVER_URL).toString(),
      exchanges: [fetchExchange],
      preferGetMethod: false,
      fetchOptions: {
        headers: {
          Authorization: `Bearer ${job.secrets?.robotAccessToken}`,
        },
      },
    });
  }

  public get job(): TJob {
    return this._job;
  }
  public get metadata(): Metadata | undefined {
    return this._metadata;
  }
  public get env(): Env {
    return this._env;
  }
  public get buildDirectory(): string {
    return path.join(this.workingdir, 'build');
  }
  public get buildLogsDirectory(): string {
    return path.join(this.workingdir, 'logs');
  }
  public get isLocal(): boolean {
    return this._isLocal;
  }
  /**
   * Directory used to store executables used during regular (non-custom) builds.
   */
  public get buildExecutablesDirectory(): string {
    return path.join(this.workingdir, 'bin');
  }
  /**
   * Directory used to store env variables registered in the current build step.
   * All values stored here will be available in the next build phase as env variables.
   */
  public get buildEnvsDirectory(): string {
    return path.join(this.workingdir, 'env');
  }
  public get packageManager(): PackageManager {
    return resolvePackageManager(this.getReactNativeProjectDirectory());
  }
  public get appConfig(): ExpoConfig {
    if (!this._appConfig) {
      this._appConfig = readAppConfig({
        projectDir: this.getReactNativeProjectDirectory(),
        env: this.env,
        logger: this.logger,
        sdkVersion: this.metadata?.sdkVersion,
      }).exp;
    }
    return this._appConfig;
  }

  public async runBuildPhase<T>(
    buildPhase: BuildPhase,
    phase: () => Promise<T>,
    {
      doNotMarkStart = false,
      doNotMarkEnd = false,
    }: {
      doNotMarkStart?: boolean;
      doNotMarkEnd?: boolean;
    } = {}
  ): Promise<T> {
    let startTimestamp = Date.now();
    try {
      this.setBuildPhase(buildPhase, { doNotMarkStart });
      startTimestamp = Date.now();
      const result = await phase();
      const durationMs = Date.now() - startTimestamp;
      const buildPhaseResult: BuildPhaseResult = this.buildPhaseSkipped
        ? BuildPhaseResult.SKIPPED
        : this.buildPhaseHasWarnings
          ? BuildPhaseResult.WARNING
          : BuildPhaseResult.SUCCESS;
      await this.endCurrentBuildPhaseAsync({ result: buildPhaseResult, doNotMarkEnd, durationMs });
      return result;
    } catch (err: any) {
      const durationMs = Date.now() - startTimestamp;
      const resolvedError = await this.handleBuildPhaseErrorAsync(err, buildPhase);
      await this.endCurrentBuildPhaseAsync({ result: BuildPhaseResult.FAIL, durationMs });
      throw resolvedError;
    }
  }

  public markBuildPhaseSkipped(): void {
    this.buildPhaseSkipped = true;
  }

  public markBuildPhaseHasWarnings(): void {
    this.buildPhaseHasWarnings = true;
  }

  public async uploadArtifact({
    artifact,
    logger,
  }: {
    artifact: ArtifactToUpload;
    logger: bunyan;
  }): Promise<{ artifactId: string | null }> {
    const result = await this._uploadArtifact({ artifact, logger });
    if (result.filename && !isGenericArtifact(artifact)) {
      this.artifacts[artifact.type] = result.filename;
    }
    return { artifactId: result.artifactId ?? null };
  }

  public updateEnv(env: Env): void {
    if (this._job.triggeredBy !== BuildTrigger.GIT_BASED_INTEGRATION) {
      throw new Error(
        'Updating environment variables is only allowed when build was triggered by a git-based integration.'
      );
    }
    this._env = {
      ...env,
      ...this._env,
      __EAS_BUILD_ENVS_DIR: this.buildEnvsDirectory,
    };
    this._env.PATH = this._env.PATH
      ? [this.buildExecutablesDirectory, this._env.PATH].join(':')
      : this.buildExecutablesDirectory;
  }

  public updateJobInformation(job: TJob, metadata: Metadata): void {
    if (this._job.triggeredBy !== BuildTrigger.GIT_BASED_INTEGRATION) {
      throw new Error(
        'Updating job information is only allowed when build was triggered by a git-based integration.'
      );
    }
    this._job = {
      ...this._job,
      ...job,
      workflowInterpolationContext:
        job.workflowInterpolationContext ?? this.job.workflowInterpolationContext,
      triggeredBy: this._job.triggeredBy,
      secrets: {
        ...this.job.secrets,
        ...job.secrets,
        robotAccessToken: job.secrets?.robotAccessToken ?? this.job.secrets?.robotAccessToken,
        environmentSecrets: [
          // Latter secrets override former ones.
          ...(this.job.secrets?.environmentSecrets ?? []),
          ...(job.secrets?.environmentSecrets ?? []),
        ],
      },
      ...(this._job.platform ? { expoBuildUrl: this._job.expoBuildUrl } : null),
    };
    this._metadata = metadata;
  }

  private async handleBuildPhaseErrorAsync(
    err: any,
    buildPhase: BuildPhase
  ): Promise<errors.BuildError> {
    const buildError = await resolveBuildPhaseErrorAsync(
      err,
      this.logBuffer.getPhaseLogs(buildPhase),
      {
        job: this.job,
        phase: buildPhase,
        env: this.env,
      },
      this.buildLogsDirectory
    );
    if (buildError.errorCode === errors.ErrorCode.UNKNOWN_ERROR) {
      // leaving message empty, website will display err.stack which already includes err.message
      this.logger.error({ err }, '');
    } else {
      this.logger.error(`Error: ${buildError.userFacingMessage}`);
    }
    return buildError;
  }

  public getReactNativeProjectDirectory(baseDirectory = this.buildDirectory): string {
    if (!this.job.platform) {
      return path.join(
        baseDirectory,
        // NOTE: We may want to add projectRootDirectory to generic jobs in the future.
        this.job.builderEnvironment.env.__EXPO_RELATIVE_BASE_DIRECTORY || '.'
      );
    }

    return path.join(baseDirectory, this.job.projectRootDirectory ?? '.');
  }

  private setBuildPhase(buildPhase: BuildPhase, { doNotMarkStart = false } = {}): void {
    if (this.buildPhase) {
      if (this.buildPhase === buildPhase) {
        return;
      } else {
        this.logger.info(
          { marker: LogMarker.END_PHASE, result: BuildPhaseResult.UNKNOWN },
          `End phase: ${this.buildPhase}`
        );
        this.logger = this.defaultLogger;
      }
    }
    this.buildPhase = buildPhase;
    this.logger = this.defaultLogger.child({ phase: buildPhase });
    if (!doNotMarkStart) {
      this.logger.info({ marker: LogMarker.START_PHASE }, `Start phase: ${this.buildPhase}`);
    }
  }

  private async endCurrentBuildPhaseAsync({
    result,
    doNotMarkEnd = false,
    durationMs,
  }: {
    result: BuildPhaseResult;
    doNotMarkEnd?: boolean;
    durationMs: number;
  }): Promise<void> {
    if (!this.buildPhase) {
      return;
    }
    await this.collectAndUpdateEnvVariablesAsync();

    this.reportBuildPhaseStats?.({ buildPhase: this.buildPhase, result, durationMs });

    if (!doNotMarkEnd) {
      this.logger.info(
        { marker: LogMarker.END_PHASE, result, durationMs },
        `End phase: ${this.buildPhase}`
      );
    }
    this.logger = this.defaultLogger;
    this.buildPhase = undefined;
    this.buildPhaseSkipped = false;
    this.buildPhaseHasWarnings = false;
  }

  private async collectAndUpdateEnvVariablesAsync(): Promise<void> {
    const filenames = await fs.readdir(this.buildEnvsDirectory);

    const entries = await Promise.all(
      filenames.map(async (basename) => {
        const rawContents = await fs.readFile(
          path.join(this.buildEnvsDirectory, basename),
          'utf-8'
        );
        return [basename, rawContents];
      })
    );
    await Promise.all(
      filenames.map(async (basename) => {
        await fs.remove(path.join(this.buildEnvsDirectory, basename));
      })
    );
    this._env = {
      ...this._env,
      ...Object.fromEntries(entries),
    };
  }

  private getEnvironmentSecrets(job: TJob): Record<string, string> {
    if (!job?.secrets?.environmentSecrets) {
      return {};
    }

    const environmentSecretsDirectory = path.join(this.workingdir, 'eas-environment-secrets');

    const environmentSecrets: Record<string, string> = {};
    for (const { name, type, value } of job.secrets.environmentSecrets) {
      if (type === EnvironmentSecretType.STRING) {
        environmentSecrets[name] = value;
      } else {
        environmentSecrets[name] = createTemporaryEnvironmentSecretFile({
          secretsDir: environmentSecretsDirectory,
          name,
          contents_base64: value,
        });
      }
    }
    return environmentSecrets;
  }
}
