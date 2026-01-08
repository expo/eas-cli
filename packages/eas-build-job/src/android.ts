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

export interface Keystore {
  dataBase64: string;
  keystorePassword: string;
  keyAlias: string;
  keyPassword?: string;
}

const KeystoreSchema = Joi.object({
  dataBase64: Joi.string().required(),
  keystorePassword: Joi.string().allow('').required(),
  keyAlias: Joi.string().required(),
  keyPassword: Joi.string().allow(''),
});

export enum BuildType {
  APK = 'apk',
  APP_BUNDLE = 'app-bundle',
}

export interface BuilderEnvironment {
  image?: string;
  node?: string;
  corepack?: boolean;
  pnpm?: string;
  yarn?: string;
  bun?: string;
  ndk?: string;
  env?: Env;
}

const BuilderEnvironmentSchema = Joi.object({
  image: Joi.string(),
  node: Joi.string(),
  corepack: Joi.boolean(),
  yarn: Joi.string(),
  pnpm: Joi.string(),
  bun: Joi.string(),
  ndk: Joi.string(),
  env: EnvSchema,
});

export interface BuildSecrets {
  buildCredentials?: {
    keystore: Keystore;
  };
  environmentSecrets?: EnvironmentSecret[];
  robotAccessToken?: string;
}

export interface Job {
  mode: BuildMode;
  type: Workflow;
  triggeredBy: BuildTrigger;
  projectArchive: ArchiveSource;
  platform: Platform.ANDROID;
  projectRootDirectory: string;
  buildProfile?: string;
  updates?: {
    channel?: string;
  };
  secrets?: BuildSecrets;
  builderEnvironment?: BuilderEnvironment;
  cache?: Cache;
  developmentClient?: boolean;
  version?: {
    versionCode?: string;
    /**
     * support for this field is implemented, but specifying it is disabled on schema level
     */
    versionName?: string;
    /**
     * support for this field is implemented, but specifying it is disabled on schema level
     */
    runtimeVersion?: string;
  };
  buildArtifactPaths?: string[];

  gradleCommand?: string;
  applicationArchivePath?: string;

  buildType?: BuildType;
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
  buildCredentials: Joi.object({ keystore: KeystoreSchema.required() }),
  environmentSecrets: EnvironmentSecretsSchema,
  robotAccessToken: Joi.string(),
});

export const JobSchema = Joi.object({
  mode: Joi.string()
    .valid(BuildMode.BUILD, BuildMode.CUSTOM, BuildMode.REPACK)
    .default(BuildMode.BUILD),
  type: Joi.string()
    .valid(...Object.values(Workflow))
    .required(),
  triggeredBy: Joi.string()
    .valid(...Object.values(BuildTrigger))
    .default(BuildTrigger.EAS_CLI),
  projectArchive: ArchiveSourceSchema.required(),
  platform: Joi.string().valid(Platform.ANDROID).required(),
  projectRootDirectory: Joi.string().required(),
  buildProfile: Joi.when('triggeredBy', {
    is: BuildTrigger.GIT_BASED_INTEGRATION,
    then: Joi.string().required(),
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
  version: Joi.object({
    versionCode: Joi.string().regex(/^\d+$/),
  }),
  buildArtifactPaths: Joi.array().items(Joi.string()),

  gradleCommand: Joi.string(),
  applicationArchivePath: Joi.string(),

  buildType: Joi.string().valid(...Object.values(BuildType)),
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
