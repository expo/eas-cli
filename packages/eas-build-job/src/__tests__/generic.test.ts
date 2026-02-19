import { randomUUID } from 'crypto';
import { ZodError } from 'zod';

import { ArchiveSourceType, BuildTrigger, EnvironmentSecretType } from '../common';
import { Generic } from '../generic';

describe('Generic.JobZ', () => {
  it('accepts valid customBuildConfig.path job', () => {
    const job: Generic.Job = {
      projectArchive: {
        type: ArchiveSourceType.GIT,
        repositoryUrl: 'https://github.com/expo/expo.git',
        gitCommitHash: '1234567890',
        gitRef: null,
      },
      steps: [
        {
          id: 'step1',
          name: 'Step 1',
          run: 'echo Hello, world!',
          shell: 'sh',
        },
      ],
      secrets: {
        robotAccessToken: 'token',
        environmentSecrets: [
          {
            name: 'secret-name',
            value: 'secret-value',
            type: EnvironmentSecretType.STRING,
          },
        ],
      },
      expoDevUrl: 'https://expo.dev/accounts/name/builds/id',
      builderEnvironment: {
        image: 'macos-sonoma-14.5-xcode-15.4',
        node: '20.15.1',
        corepack: true,
        env: {
          KEY1: 'value1',
        },
      },
      triggeredBy: BuildTrigger.GIT_BASED_INTEGRATION,
      appId: randomUUID(),
      initiatingUserId: randomUUID(),
    };
    expect(Generic.JobZ.parse(job)).toEqual(job);
  });

  it('accepts valid steps job', () => {
    const job: Generic.Job = {
      projectArchive: {
        type: ArchiveSourceType.GIT,
        repositoryUrl: 'https://github.com/expo/expo.git',
        gitCommitHash: '1234567890',
        gitRef: null,
      },
      steps: [
        {
          id: 'step1',
          name: 'Step 1',
          run: 'echo Hello, world!',
          shell: 'sh',
          env: {
            KEY1: 'value1',
          },
        },
      ],
      secrets: {
        robotAccessToken: 'token',
        environmentSecrets: [
          {
            name: 'secret-name',
            value: 'secret-value',
            type: EnvironmentSecretType.STRING,
          },
        ],
      },
      expoDevUrl: 'https://expo.dev/accounts/name/builds/id',
      builderEnvironment: {
        image: 'macos-sonoma-14.5-xcode-15.4',
        node: '20.15.1',
        corepack: false,
        env: {
          KEY1: 'value1',
        },
      },
      triggeredBy: BuildTrigger.GIT_BASED_INTEGRATION,
      appId: randomUUID(),
      initiatingUserId: randomUUID(),
    };
    expect(Generic.JobZ.parse(job)).toEqual(job);
  });

  it('accepts hooks with arbitrary names', () => {
    const job: Generic.Job = {
      projectArchive: {
        type: ArchiveSourceType.GIT,
        repositoryUrl: 'https://github.com/expo/expo.git',
        gitCommitHash: '1234567890',
        gitRef: null,
      },
      hooks: {
        before_install_node_modules: [
          {
            id: 'before-install',
            run: 'echo before install',
            shell: 'sh',
          },
        ],
        my_custom_hook: [],
      },
      steps: [
        {
          id: 'step1',
          name: 'Step 1',
          run: 'echo Hello, world!',
          shell: 'sh',
        },
      ],
      secrets: {
        robotAccessToken: 'token',
        environmentSecrets: [
          {
            name: 'secret-name',
            value: 'secret-value',
            type: EnvironmentSecretType.STRING,
          },
        ],
      },
      expoDevUrl: 'https://expo.dev/accounts/name/builds/id',
      builderEnvironment: {
        image: 'macos-sonoma-14.5-xcode-15.4',
        node: '20.15.1',
        corepack: false,
        env: {
          KEY1: 'value1',
        },
      },
      triggeredBy: BuildTrigger.GIT_BASED_INTEGRATION,
      appId: randomUUID(),
      initiatingUserId: randomUUID(),
    };
    expect(Generic.JobZ.parse(job)).toEqual(job);
  });

  it('errors when hook step definition is invalid', () => {
    const job = {
      projectArchive: {
        type: ArchiveSourceType.GIT,
        repositoryUrl: 'https://github.com/expo/expo.git',
        gitCommitHash: '1234567890',
        gitRef: null,
      },
      hooks: {
        before_install_node_modules: [
          {
            id: 'missing-run-or-uses',
          },
        ],
      },
      steps: [
        {
          id: 'step1',
          name: 'Step 1',
          run: 'echo Hello, world!',
          shell: 'sh',
        },
      ],
      secrets: {
        robotAccessToken: 'token',
        environmentSecrets: [
          {
            name: 'secret-name',
            value: 'secret-value',
            type: EnvironmentSecretType.STRING,
          },
        ],
      },
      expoDevUrl: 'https://expo.dev/accounts/name/builds/id',
      builderEnvironment: {
        image: 'macos-sonoma-14.5-xcode-15.4',
        node: '20.15.1',
        corepack: false,
        env: {
          KEY1: 'value1',
        },
      },
      triggeredBy: BuildTrigger.GIT_BASED_INTEGRATION,
      appId: randomUUID(),
      initiatingUserId: randomUUID(),
    };
    expect(() => Generic.JobZ.parse(job)).toThrow(ZodError);
  });

  it('errors when steps are not provided', () => {
    const job: Omit<Generic.Job, 'customBuildConfig' | 'steps'> = {
      projectArchive: {
        type: ArchiveSourceType.GIT,
        repositoryUrl: 'https://github.com/expo/expo.git',
        gitCommitHash: '1234567890',
        gitRef: null,
      },
      secrets: {
        robotAccessToken: 'token',
        environmentSecrets: [
          {
            name: 'secret-name',
            value: 'secret-value',
            type: EnvironmentSecretType.STRING,
          },
        ],
      },
      expoDevUrl: 'https://expo.dev/accounts/name/builds/id',
      builderEnvironment: {
        image: 'macos-sonoma-14.5-xcode-15.4',
        node: '20.15.1',
        env: {
          KEY1: 'value1',
        },
      },
      triggeredBy: BuildTrigger.GIT_BASED_INTEGRATION,
      appId: randomUUID(),
      initiatingUserId: randomUUID(),
    };
    expect(() => Generic.JobZ.parse(job)).toThrow(ZodError);
  });

  it('accepts none archive source type', () => {
    const job: Generic.Job = {
      projectArchive: {
        type: ArchiveSourceType.NONE,
      },
      steps: [
        {
          id: 'step1',
          name: 'Step 1',
          run: 'echo Hello, world!',
          shell: 'sh',
          env: {
            KEY1: 'value1',
          },
        },
      ],
      secrets: {
        robotAccessToken: 'token',
        environmentSecrets: [
          {
            name: 'secret-name',
            value: 'secret-value',
            type: EnvironmentSecretType.STRING,
          },
        ],
      },
      expoDevUrl: 'https://expo.dev/accounts/name/builds/id',
      builderEnvironment: {
        image: 'macos-sonoma-14.5-xcode-15.4',
        node: '20.15.1',
        corepack: false,
        env: {
          KEY1: 'value1',
        },
      },
      triggeredBy: BuildTrigger.GIT_BASED_INTEGRATION,
      appId: randomUUID(),
      initiatingUserId: randomUUID(),
    };
    expect(Generic.JobZ.parse(job)).toEqual(job);
  });
});
