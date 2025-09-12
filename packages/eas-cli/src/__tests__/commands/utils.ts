import { ExpoConfig } from '@expo/config';
import { AppVersionSource, EasJson } from '@expo/eas-json';
import { Command, Config } from '@oclif/core';
import { vol } from 'memfs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

import { ContextInput, ContextOutput } from '../../commandUtils/EasCommand';
import { DynamicConfigContextFn } from '../../commandUtils/context/DynamicProjectConfigContextField';
import {
  AppFragment,
  Role,
  WorkflowJobStatus,
  WorkflowJobType,
  WorkflowRunByIdWithJobsQuery,
  WorkflowRunFragment,
  WorkflowRunStatus,
  WorkflowRunTriggerEventType,
} from '../../graphql/generated';

export function getMockEasJson(): EasJson {
  return {
    cli: {},
    build: {
      production: {},
    },
  };
}

export const mockProjectId = 'fake-project-id';

export function getMockAppFragment(): AppFragment {
  return {
    id: mockProjectId,
    slug: 'testapp',
    name: 'testapp',
    fullName: '@testuser/testpp',
    ownerAccount: {
      id: 'test-account-id',
      name: 'testuser',
      users: [
        {
          role: Role.Owner,
          actor: {
            id: 'test-user-id',
          },
        },
      ],
    },
  };
}

export function getMockExpoConfig(): ExpoConfig {
  return {
    name: 'testapp',
    slug: 'tetsapp',
    extra: {
      projectId: mockProjectId,
    },
  };
}

export interface LocalProjectContext {
  projectDir: string;
  exp?: ExpoConfig;
  appId?: string;
}

export function mockCommandContext<
  C extends {
    [name: string]: any;
  } = object,
>(
  commandClass: { contextDefinition: ContextInput<C> },
  overrides: {
    easJson?: EasJson;
    exp?: ExpoConfig;
    projectId?: string;
    getDynamicPrivateProjectConfigAsync?: DynamicConfigContextFn;
    getDynamicPublicProjectConfigAsync?: DynamicConfigContextFn;
  }
): ContextOutput<C> {
  const projectDir = path.join('/test', uuidv4());
  vol.reset();
  vol.fromJSON({ 'eas.json': JSON.stringify(overrides.easJson ?? getMockEasJson()) }, projectDir);
  const contextDefinition = commandClass.contextDefinition;

  const result: any = {};
  for (const [contextKey] of Object.entries(contextDefinition)) {
    if (contextKey === 'loggedIn') {
      result.loggedIn = {};
    }
    if (contextKey === 'projectId') {
      result.projectId = overrides.projectId ?? mockProjectId;
    }
    if (contextKey === 'projectDir') {
      result.projectDir = projectDir;
    }
    if (contextKey === 'maybeLoggedIn') {
      result.maybeLoggedIn = {};
    }
    if (contextKey === 'sessionManager') {
      result.sessionManager = {};
    }
    if (contextKey === 'projectConfig') {
      result.projectConfig = {
        exp: overrides.exp ?? getMockExpoConfig(),
        projectId: overrides.projectId ?? mockProjectId,
        projectDir,
      };
    }
    if (contextKey === 'getDynamicPrivateProjectConfigAsync') {
      result.getDynamicPrivateProjectConfigAsync = () => ({
        exp: overrides.exp ?? getMockExpoConfig(),
        projectId: overrides.projectId ?? mockProjectId,
        projectDir,
      });
    }

    if (contextKey === 'getDynamicPublicProjectConfigAsync') {
      result.getDynamicPublicProjectConfigAsync = () => ({
        exp: overrides.exp ?? getMockExpoConfig(),
        projectId: overrides.projectId ?? mockProjectId,
        projectDir,
      });
    }
  }
  return result;
}

export function mockTestCommand<T extends Command>(
  commandConstructor: new (argv: string[], config: Config) => T,
  argv: string[],
  ctx: any
): T {
  const cmd = new commandConstructor(argv, new Config({ root: __dirname }));
  (cmd as any).getContextAsync = jest.fn(() => ctx);
  return cmd;
}

export class NoErrorThrownError extends Error {}

export const getErrorAsync = async <TError = any>(
  call: () => unknown
): Promise<TError | NoErrorThrownError> => {
  try {
    await call();
    throw new NoErrorThrownError();
  } catch (error: unknown) {
    return error as TError;
  }
};

export const getError = <TError = any>(call: () => unknown): TError | NoErrorThrownError => {
  try {
    call();
    throw new NoErrorThrownError();
  } catch (error: unknown) {
    return error as TError;
  }
};

export function withRemoteVersionSource(easJson: EasJson): EasJson {
  return {
    ...easJson,
    cli: {
      ...easJson.cli,
      appVersionSource: AppVersionSource.REMOTE,
    },
  };
}

export function withLocalVersionSource(easJson: EasJson): EasJson {
  return {
    ...easJson,
    cli: {
      ...easJson.cli,
      appVersionSource: AppVersionSource.LOCAL,
    },
  };
}

export function getMockEmptyWorkflowRunsFragment(): WorkflowRunFragment[] {
  return getMockWorkflowRunsFragment();
}

export function getMockWorkflowRunsFragment(
  params?:
    | undefined
    | {
        successes?: number;
        failures?: number;
        pending?: number;
        withJobs?: number;
      }
): WorkflowRunFragment[] {
  const { successes = 0, failures = 0, pending = 0, withJobs = 0 } = params ?? {};
  const runs: any[] = [];
  for (let i = 0; i < successes; i++) {
    runs.push({
      id: `success-${i}`,
      status: WorkflowRunStatus.Success,
      errors: [],
      createdAt: '2022-01-01T00:00:00.000Z',
      updatedAt: '2022-01-01T00:00:00.000Z',
      gitCommitHash: '1234567890',
      gitCommitMessage: 'commit message',
      workflow: {
        name: 'build',
        id: 'build',
        fileName: 'build.yml',
      },
    });
  }
  for (let i = 0; i < failures; i++) {
    runs.push({
      id: `failure-${i}`,
      errors: ['Failed'],
      status: WorkflowRunStatus.Failure,
      createdAt: '2022-01-01T00:00:00.000Z',
      updatedAt: '2022-01-01T00:00:00.000Z',
      gitCommitHash: '1234567890',
      gitCommitMessage: 'commit message',
      workflow: {
        name: 'build',
        id: 'build',
        fileName: 'build.yml',
      },
    });
  }
  for (let i = 0; i < pending; i++) {
    runs.push({
      id: `pending-${i}`,
      errors: [],
      status: WorkflowRunStatus.InProgress,
      createdAt: '2022-01-01T00:00:00.000Z',
      updatedAt: '2022-01-01T00:00:00.000Z',
      gitCommitHash: '1234567890',
      gitCommitMessage: 'commit message',
      workflow: {
        name: 'build',
        id: 'build',
        fileName: 'build.yml',
      },
    });
  }
  for (let i = 0; i < withJobs; i++) {
    runs.push(getMockWorkflowRunWithJobsFragment());
  }
  return runs;
}

export function getMockWorkflowJobFragment(
  runId?: string
): WorkflowRunByIdWithJobsQuery['workflowRuns']['byId']['jobs'][number] {
  return {
    id: 'job1',
    key: 'job1',
    name: 'job1',
    status: WorkflowJobStatus.Success,
    type: WorkflowJobType.Build,
    createdAt: '2022-01-01T00:00:00.000Z',
    updatedAt: '2022-01-01T00:00:00.000Z',
    outputs: {},
    errors: [],
    workflowRun: {
      id: runId ?? 'build1',
    },
    turtleJobRun: {
      id: 'job1',
      logFileUrls: ['https://example.com/log1'],
      errors: [],
      artifacts: [],
    },
  };
}

export function getMockWorkflowRunWithJobsFragment(
  runID?: string
): WorkflowRunByIdWithJobsQuery['workflowRuns']['byId'] {
  const id = runID ?? 'build1';
  return {
    id,
    status: WorkflowRunStatus.Failure,
    triggerEventType: WorkflowRunTriggerEventType.Manual,
    createdAt: '2022-01-01T00:00:00.000Z',
    updatedAt: '2022-01-01T00:00:00.000Z',
    gitCommitHash: '1234567890',
    gitCommitMessage: 'commit message',
    errors: [],
    workflow: {
      id: 'build',
      name: 'build',
      fileName: 'build.yml',
      app: {
        id: mockProjectId,
        __typename: 'App',
        name: 'App',
        ownerAccount: {
          id: 'account-id',
          name: 'account-name',
          __typename: 'Account',
        },
      },
    },
    jobs: [getMockWorkflowJobFragment(id)],
  };
}
