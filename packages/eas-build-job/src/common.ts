import Joi from 'joi';
import { z } from 'zod';

import { BuildPhase, BuildPhaseResult } from './logs';
import { validateSteps } from './step';

export enum BuildMode {
  BUILD = 'build',
  RESIGN = 'resign',
  CUSTOM = 'custom',
  REPACK = 'repack',
}

export enum Workflow {
  GENERIC = 'generic',
  MANAGED = 'managed',
  UNKNOWN = 'unknown',
}

export enum Platform {
  ANDROID = 'android',
  IOS = 'ios',
}

export enum ArchiveSourceType {
  NONE = 'NONE',
  URL = 'URL',
  PATH = 'PATH',
  GCS = 'GCS',
  GIT = 'GIT',
  R2 = 'R2',
}

export enum BuildTrigger {
  EAS_CLI = 'EAS_CLI',
  GIT_BASED_INTEGRATION = 'GIT_BASED_INTEGRATION',
}

export type ArchiveSource =
  | { type: ArchiveSourceType.NONE }
  | { type: ArchiveSourceType.GCS; bucketKey: string; metadataLocation?: string }
  | { type: ArchiveSourceType.R2; bucketKey: string }
  | { type: ArchiveSourceType.URL; url: string }
  | { type: ArchiveSourceType.PATH; path: string }
  | {
      type: ArchiveSourceType.GIT;
      /**
       * Url that can be used to clone repository.
       * It should contain embedded credentials for private registries.
       */
      repositoryUrl: string;
      /** A Git ref - points to a branch head, tag head or a branch name. */
      gitRef: string | null;
      /**
       * Git commit hash.
       */
      gitCommitHash: string;
    };

export const ArchiveSourceSchema = Joi.object<ArchiveSource>({
  type: Joi.string()
    .valid(...Object.values(ArchiveSourceType))
    .required(),
})
  .when(Joi.object({ type: ArchiveSourceType.GCS }).unknown(), {
    then: Joi.object({
      type: Joi.string().valid(ArchiveSourceType.GCS).required(),
      bucketKey: Joi.string().required(),
      metadataLocation: Joi.string(),
    }),
  })
  .when(Joi.object({ type: ArchiveSourceType.URL }).unknown(), {
    then: Joi.object({
      type: Joi.string().valid(ArchiveSourceType.URL).required(),
      url: Joi.string().uri().required(),
    }),
  })
  .when(Joi.object({ type: ArchiveSourceType.GIT }).unknown(), {
    then: Joi.object({
      type: Joi.string().valid(ArchiveSourceType.GIT).required(),
      repositoryUrl: Joi.string().required(),
      gitCommitHash: Joi.string().required(),
      gitRef: Joi.string().allow(null).required(),
    }),
  })
  .when(Joi.object({ type: ArchiveSourceType.PATH }).unknown(), {
    then: Joi.object({
      type: Joi.string().valid(ArchiveSourceType.PATH).required(),
      path: Joi.string().required(),
    }),
  });

export const ArchiveSourceSchemaZ = z.discriminatedUnion('type', [
  z.object({
    type: z.literal(ArchiveSourceType.GIT),
    repositoryUrl: z.string().url(),
    gitRef: z.string().nullable(),
    gitCommitHash: z.string(),
  }),
  z.object({
    type: z.literal(ArchiveSourceType.PATH),
    path: z.string(),
  }),
  z.object({
    type: z.literal(ArchiveSourceType.URL),
    url: z.string().url(),
  }),
  z.object({
    type: z.literal(ArchiveSourceType.GCS),
    bucketKey: z.string(),
    metadataLocation: z.string().optional(),
  }),
  z.object({
    type: z.literal(ArchiveSourceType.NONE),
  }),
]);

export type Env = Record<string, string>;
export const EnvSchema = Joi.object().pattern(Joi.string(), Joi.string());

export type EnvironmentSecret = {
  name: string;
  type: EnvironmentSecretType;
  value: string;
};
export enum EnvironmentSecretType {
  STRING = 'string',
  FILE = 'file',
}
export const EnvironmentSecretsSchema = Joi.array().items(
  Joi.object({
    name: Joi.string().required(),
    value: Joi.string().allow('').required(),
    type: Joi.string()
      .valid(...Object.values(EnvironmentSecretType))
      .required(),
  })
);
export const EnvironmentSecretZ = z.object({
  name: z.string(),
  value: z.string(),
  type: z.nativeEnum(EnvironmentSecretType),
});

export interface Cache {
  disabled: boolean;
  clear: boolean;
  key?: string;
  /**
   * @deprecated We don't cache anything by default anymore.
   */
  cacheDefaultPaths?: boolean;
  /**
   * @deprecated We use paths now since there is no default caching anymore.
   */
  customPaths?: string[];
  paths: string[];
}

export const CacheSchema = Joi.object({
  disabled: Joi.boolean().default(false),
  clear: Joi.boolean().default(false),
  key: Joi.string().allow('').max(128),
  cacheDefaultPaths: Joi.boolean(),
  customPaths: Joi.array().items(Joi.string()),
  paths: Joi.array().items(Joi.string()).default([]),
});

export interface BuildPhaseStats {
  buildPhase: BuildPhase;
  result: BuildPhaseResult;
  durationMs: number;
}

const GitHubContextZ = z.object({
  triggering_actor: z.string().optional(),
  event_name: z.enum(['push', 'pull_request', 'workflow_dispatch', 'schedule']),
  sha: z.string(),
  ref: z.string(),
  ref_name: z.string(),
  ref_type: z.string(),
  commit_message: z.string().optional(),
  label: z.string().optional(),
  repository: z.string().optional(),
  repository_owner: z.string().optional(),
  event: z
    .object({
      label: z
        .object({
          name: z.string(),
        })
        .optional(),
      head_commit: z
        .object({
          message: z.string(),
          id: z.string(),
        })
        .optional(),
      pull_request: z
        .object({
          number: z.number(),
        })
        .optional(),
      number: z.number().optional(),
      schedule: z.string().optional(),
      inputs: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    })
    .optional(),
});

export const StaticWorkflowInterpolationContextZ = z.object({
  after: z.record(
    z.string(),
    z.object({
      status: z.string(),
      outputs: z.record(z.string(), z.string().nullable()),
    })
  ),
  needs: z.record(
    z.string(),
    z.object({
      status: z.string(),
      outputs: z.record(z.string(), z.string().nullable()),
    })
  ),
  inputs: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  github:
    // We need to .optional() to support jobs that are not triggered by a GitHub event.
    GitHubContextZ.optional(),
  workflow: z
    .object({
      id: z.string(),
      name: z.string(),
      filename: z.string(),
      url: z.string().url(),
    })
    .passthrough(),
});

export type StaticWorkflowInterpolationContext = z.infer<
  typeof StaticWorkflowInterpolationContextZ
>;

export type DynamicInterpolationContext = {
  env: Record<string, string | undefined>;
  success: () => boolean;
  failure: () => boolean;
  always: () => boolean;
  never: () => boolean;
  fromJSON: (value: string) => unknown;
  toJSON: (value: unknown) => string;
  contains: (value: string, substring: string) => boolean;
  startsWith: (value: string, prefix: string) => boolean;
  endsWith: (value: string, suffix: string) => boolean;
  hashFiles: (...globs: string[]) => string;
  replaceAll: (input: string, stringToReplace: string, replacementString: string) => string;
  substring: (input: string, start: number, end?: number) => string;
};

export type WorkflowInterpolationContext = StaticWorkflowInterpolationContext &
  DynamicInterpolationContext;

export const CustomBuildConfigSchema = Joi.object().when('.mode', {
  is: [BuildMode.CUSTOM, BuildMode.REPACK],
  then: Joi.object().when('.customBuildConfig.path', {
    is: Joi.exist(),
    then: Joi.object({
      customBuildConfig: Joi.object({
        path: Joi.string().required(),
      }).required(),
      steps: Joi.any().strip(),
      outputs: Joi.any().strip(),
    }),
    otherwise: Joi.object({
      customBuildConfig: Joi.any().strip(),
      steps: Joi.array()
        .items(Joi.any())
        .required()
        .custom((steps) => validateSteps(steps), 'steps validation'),
      outputs: Joi.object().pattern(Joi.string(), Joi.string()).required(),
    }),
  }),
  otherwise: Joi.object({
    customBuildConfig: Joi.any().strip(),
    steps: Joi.any().strip(),
    outputs: Joi.any().strip(),
  }),
});

export enum EasCliNpmTags {
  STAGING = 'latest-eas-build-staging',
  PRODUCTION = 'latest-eas-build',
}
