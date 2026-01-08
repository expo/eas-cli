import Joi from 'joi';
import { LoggerLevel } from '@expo/logger';

import {
  ArchiveSource,
  ArchiveSourceSchema,
  Env,
  EnvSchema,
  Platform,
  Workflow,
  Cache,
  CacheSchema,
  EnvironmentSecretsSchema,
  EnvironmentSecret,
  BuildTrigger,
  BuildMode,
  StaticWorkflowInterpolationContextZ,
  StaticWorkflowInterpolationContext,
  CustomBuildConfigSchema,
} from './common';
import { Step } from './step';

export type DistributionType = 'store' | 'internal' | 'simulator';

const TargetCredentialsSchema = Joi.object().keys({
  provisioningProfileBase64: Joi.string().required(),
  distributionCertificate: Joi.object({
    dataBase64: Joi.string().required(),
    password: Joi.string().allow('').required(),
  }).required(),
});

export interface TargetCredentials {
  provisioningProfileBase64: string;
  distributionCertificate: DistributionCertificate;
}

const BuildCredentialsSchema = Joi.object().pattern(
  Joi.string().required(),
  TargetCredentialsSchema
);

type Target = string;
export type BuildCredentials = Record<Target, TargetCredentials>;

export interface DistributionCertificate {
  dataBase64: string;
  password: string;
}
export interface BuilderEnvironment {
  image?: string;
  node?: string;
  corepack?: boolean;
  yarn?: string;
  bun?: string;
  pnpm?: string;
  bundler?: string;
  fastlane?: string;
  cocoapods?: string;
  env?: Env;
}

const BuilderEnvironmentSchema = Joi.object({
  image: Joi.string(),
  node: Joi.string(),
  corepack: Joi.boolean(),
  yarn: Joi.string(),
  pnpm: Joi.string(),
  bun: Joi.string(),
  bundler: Joi.string(),
  fastlane: Joi.string(),
  cocoapods: Joi.string(),
  env: EnvSchema,
});

export interface BuildSecrets {
  buildCredentials?: BuildCredentials;
  environmentSecrets?: EnvironmentSecret[];
  robotAccessToken?: string;
}

export interface Job {
  mode: BuildMode;
  type: Workflow;
  triggeredBy: BuildTrigger;
  projectArchive: ArchiveSource;
  resign?: {
    applicationArchiveSource: ArchiveSource;
  };
  platform: Platform.IOS;
  projectRootDirectory?: string;
  buildProfile?: string;
  updates?: {
    channel?: string;
  };
  secrets?: BuildSecrets;
  builderEnvironment?: BuilderEnvironment;
  cache?: Cache;
  developmentClient?: boolean;
  simulator?: boolean;
  version?: {
    buildNumber?: string;
    /**
     * support for this field is implemented, but specifying it is disabled on schema level
     */
    appVersion?: string;
    /**
     * support for this field is implemented, but specifying it is disabled on schema level
     */
    runtimeVersion?: string;
  };
  buildArtifactPaths?: string[];

  scheme?: string;
  buildConfiguration?: string;
  applicationArchivePath?: string;

  username?: string;

  customBuildConfig?: {
    path: string;
  };
  steps?: Step[];
  outputs?: Record<string, string>;

  experimental?: {
    prebuildCommand?: string;
  };
  expoBuildUrl?: string;
  githubTriggerOptions?: {
    autoSubmit: boolean;
    submitProfile?: string;
  };
  loggerLevel?: LoggerLevel;

  workflowInterpolationContext?: StaticWorkflowInterpolationContext;

  initiatingUserId: string;
  appId: string;

  environment?: string;
}

const SecretsSchema = Joi.object({
  buildCredentials: BuildCredentialsSchema,
  environmentSecrets: EnvironmentSecretsSchema,
  robotAccessToken: Joi.string(),
});

export const JobSchema = Joi.object({
  mode: Joi.string()
    .valid(...Object.values(BuildMode))
    .default(BuildMode.BUILD),
  type: Joi.when('mode', {
    is: Joi.string().valid(BuildMode.RESIGN),
    then: Joi.string().valid(Workflow.UNKNOWN).default(Workflow.UNKNOWN),
    otherwise: Joi.string()
      .valid(...Object.values(Workflow))
      .required(),
  }),
  triggeredBy: Joi.string()
    .valid(...Object.values(BuildTrigger))
    .default(BuildTrigger.EAS_CLI),
  projectArchive: ArchiveSourceSchema.required(),
  resign: Joi.when('mode', {
    is: Joi.string().valid(BuildMode.RESIGN),
    then: Joi.object({
      applicationArchiveSource: ArchiveSourceSchema.required(),
    }).required(),
    otherwise: Joi.any().strip(),
  }),
  platform: Joi.string().valid(Platform.IOS).required(),
  projectRootDirectory: Joi.when('mode', {
    is: Joi.string().valid(BuildMode.RESIGN),
    then: Joi.any().strip(),
    otherwise: Joi.string().required(),
  }),
  buildProfile: Joi.when('mode', {
    is: Joi.string().valid(BuildMode.BUILD),
    then: Joi.when('triggeredBy', {
      is: Joi.string().valid(BuildTrigger.GIT_BASED_INTEGRATION),
      then: Joi.string().required(),
      otherwise: Joi.string(),
    }),
    otherwise: Joi.string(),
  }),
  updates: Joi.object({
    channel: Joi.string(),
  }),
  secrets: Joi.when('mode', {
    is: Joi.string().valid(BuildMode.CUSTOM),
    then: SecretsSchema,
    otherwise: SecretsSchema.required(),
  }),
  builderEnvironment: BuilderEnvironmentSchema,
  cache: CacheSchema.default(),
  developmentClient: Joi.boolean(),
  simulator: Joi.boolean(),
  version: Joi.object({
    buildNumber: Joi.string(),
  }),
  buildArtifactPaths: Joi.array().items(Joi.string()),

  scheme: Joi.string(),
  buildConfiguration: Joi.string(),
  applicationArchivePath: Joi.string(),

  username: Joi.string(),

  experimental: Joi.object({
    prebuildCommand: Joi.string(),
  }),
  expoBuildUrl: Joi.string().uri().optional(),
  githubTriggerOptions: Joi.object({
    autoSubmit: Joi.boolean().default(false),
    submitProfile: Joi.string(),
  }),
  loggerLevel: Joi.string().valid(...Object.values(LoggerLevel)),

  initiatingUserId: Joi.string().required(),
  appId: Joi.string().required(),

  environment: Joi.string(),

  workflowInterpolationContext: Joi.object().custom((workflowInterpolationContext) =>
    StaticWorkflowInterpolationContextZ.optional().parse(workflowInterpolationContext)
  ),
}).concat(CustomBuildConfigSchema);
