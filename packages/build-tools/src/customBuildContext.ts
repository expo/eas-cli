import {
  BuildJob,
  BuildPhase,
  BuildTrigger,
  Env,
  Job,
  Metadata,
  Platform,
  StaticJobInterpolationContext,
} from '@expo/eas-build-job';
import { bunyan } from '@expo/logger';
import { BuildRuntimePlatform, ExternalBuildContextProvider } from '@expo/steps';
import { Client } from '@urql/core';
import assert from 'assert';
import path from 'path';

import { ArtifactToUpload, BuildContext } from './context';

const platformToBuildRuntimePlatform: Record<Platform, BuildRuntimePlatform> = {
  [Platform.ANDROID]: BuildRuntimePlatform.LINUX,
  [Platform.IOS]: BuildRuntimePlatform.DARWIN,
};

export interface BuilderRuntimeApi {
  uploadArtifact: (spec: { artifact: ArtifactToUpload; logger: bunyan }) => Promise<{
    artifactId: string | null;
  }>;
}

export class CustomBuildContext<TJob extends Job = Job> implements ExternalBuildContextProvider {
  /*
   * Directory that contains project sources before eas/checkout.
   */
  public readonly projectSourceDirectory: string;

  /*
   * Directory where build is executed. eas/checkout will copy sources here.
   */
  public readonly projectTargetDirectory: string;

  /*
   * Directory where all build steps will be executed unless configured otherwise.
   */
  public readonly defaultWorkingDirectory: string;

  /*
   * Directory where build logs will be stored unless configure otherwise.
   */
  public readonly buildLogsDirectory: string;

  /**
   * Time of the start of the build.
   */
  public readonly startTime: Date;

  public readonly logger: bunyan;
  public readonly graphqlClient: Client;
  public readonly runtimeApi: BuilderRuntimeApi;
  public job: TJob;
  public metadata?: Metadata;

  private _env: Env;

  constructor(buildCtx: BuildContext<TJob>) {
    this._env = buildCtx.env;
    this.job = buildCtx.job;
    this.metadata = buildCtx.metadata;

    this.logger = buildCtx.logger.child({ phase: BuildPhase.CUSTOM });
    this.graphqlClient = buildCtx.graphqlClient;
    this.projectSourceDirectory = path.join(buildCtx.workingdir, 'temporary-custom-build');
    this.projectTargetDirectory = path.join(buildCtx.workingdir, 'build');
    this.defaultWorkingDirectory = buildCtx.getReactNativeProjectDirectory();
    this.buildLogsDirectory = path.join(buildCtx.workingdir, 'logs');
    this.runtimeApi = {
      uploadArtifact: (...args) => buildCtx['uploadArtifact'](...args),
    };
    this.startTime = new Date();
  }

  public hasBuildJob(): this is CustomBuildContext<BuildJob> {
    return Boolean(this.job.platform);
  }

  public get runtimePlatform(): BuildRuntimePlatform {
    // Generic jobs are not per-platform.
    if (!this.job.platform) {
      assert(
        process.platform === 'linux' || process.platform === 'darwin',
        `Invalid platform, expected linux or darwin, got: ${process.platform}`
      );
      return {
        linux: BuildRuntimePlatform.LINUX,
        darwin: BuildRuntimePlatform.DARWIN,
      }[process.platform];
    }

    return platformToBuildRuntimePlatform[this.job.platform];
  }

  public get env(): Env {
    return this._env;
  }

  // We omit steps, because CustomBuildContext does not have steps.
  public staticContext(): Omit<StaticJobInterpolationContext, 'steps'> {
    return {
      ...this.job.workflowInterpolationContext,
      expoApiServerURL: this.env.__API_SERVER_URL,
      job: this.job,
      metadata: this.metadata ?? null,
    };
  }

  public updateEnv(env: Env): void {
    this._env = env;
  }

  public updateJobInformation(job: TJob, metadata: Metadata): void {
    if (this.job.triggeredBy !== BuildTrigger.GIT_BASED_INTEGRATION) {
      throw new Error(
        'Updating job information is only allowed when build was triggered by a git-based integration.'
      );
    }
    this.job = {
      ...this.job,
      ...job,
      workflowInterpolationContext:
        job.workflowInterpolationContext ?? this.job.workflowInterpolationContext,
      triggeredBy: this.job.triggeredBy,
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
      ...(this.job.platform ? { expoBuildUrl: this.job.expoBuildUrl } : null),
    };
    this.metadata = metadata;
  }
}
