import { ExpoConfig } from '@expo/config';
import { AppVersionSource, EasJson } from '@expo/eas-json';
import { Command, Config } from '@oclif/core';
import { vol } from 'memfs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

import { ContextInput, ContextOutput } from '../../commandUtils/EasCommand';
import { DynamicConfigContextFn } from '../../commandUtils/context/DynamicProjectConfigContextField';
import { AppFragment, Role } from '../../graphql/generated';

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
