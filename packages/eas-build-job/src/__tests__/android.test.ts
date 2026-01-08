import { randomUUID } from 'crypto';

import Joi from 'joi';
import { LoggerLevel } from '@expo/logger';

import * as Android from '../android';
import { ArchiveSourceType, BuildMode, BuildTrigger, Platform, Workflow } from '../common';

const joiOptions: Joi.ValidationOptions = {
  stripUnknown: true,
  convert: true,
  abortEarly: false,
};

const secrets = {
  buildCredentials: {
    keystore: {
      dataBase64: 'MjEzNwo=',
      keystorePassword: 'pass1',
      keyAlias: 'alias',
      keyPassword: 'pass2',
    },
  },
};

describe('Android.JobSchema', () => {
  test('valid generic job', () => {
    const genericJob = {
      secrets,
      platform: Platform.ANDROID,
      type: Workflow.GENERIC,
      projectArchive: {
        type: ArchiveSourceType.URL,
        url: 'http://localhost:3000',
      },
      gradleCommand: ':app:bundleRelease',
      applicationArchivePath: 'android/app/build/outputs/bundle/release/app-release.aab',
      projectRootDirectory: '.',
      builderEnvironment: {
        image: 'default',
        node: '1.2.3',
        corepack: true,
        yarn: '2.3.4',
        ndk: '4.5.6',
        bun: '1.0.0',
        env: {
          SOME_ENV: '123',
        },
      },
      expoBuildUrl: 'https://expo.dev/fake/build/url',
      initiatingUserId: randomUUID(),
      appId: randomUUID(),
    };

    const { value, error } = Android.JobSchema.validate(genericJob, joiOptions);
    expect(value).toMatchObject(genericJob);
    expect(error).toBeFalsy();
  });

  test('valid generic job with metadataLocation', () => {
    const genericJob = {
      secrets,
      platform: Platform.ANDROID,
      type: Workflow.GENERIC,
      projectArchive: {
        type: ArchiveSourceType.GCS,
        bucketKey: 'path/to/file',
        metadataLocation: 'path/to/metadata',
      },
      gradleCommand: ':app:bundleRelease',
      applicationArchivePath: 'android/app/build/outputs/bundle/release/app-release.aab',
      projectRootDirectory: '.',
      builderEnvironment: {
        image: 'default',
        node: '1.2.3',
        corepack: false,
        yarn: '2.3.4',
        ndk: '4.5.6',
        bun: '1.0.0',
        env: {
          SOME_ENV: '123',
        },
      },
      initiatingUserId: randomUUID(),
      appId: randomUUID(),
    };

    const { value, error } = Android.JobSchema.validate(genericJob, joiOptions);
    expect(value).toMatchObject(genericJob);
    expect(error).toBeFalsy();
  });

  test('invalid generic job', () => {
    const genericJob = {
      secrets,
      platform: Platform.ANDROID,
      type: Workflow.GENERIC,
      projectArchive: {
        type: ArchiveSourceType.URL,
        url: 'url',
      },
      gradleCommand: 1,
      uknownField: 'field',
      projectRootDirectory: '.',
      initiatingUserId: randomUUID(),
      appId: randomUUID(),
    };

    const { value, error } = Android.JobSchema.validate(genericJob, joiOptions);
    expect(error?.message).toBe(
      '"projectArchive.url" must be a valid uri. "gradleCommand" must be a string'
    );
    expect(value).not.toMatchObject(genericJob);
  });

  test('valid managed job', () => {
    const managedJob = {
      secrets,
      platform: Platform.ANDROID,
      type: Workflow.MANAGED,
      buildType: Android.BuildType.APP_BUNDLE,
      username: 'turtle-tutorial',
      projectArchive: {
        type: ArchiveSourceType.URL,
        url: 'http://localhost:3000',
      },
      projectRootDirectory: '.',
      builderEnvironment: {
        image: 'default',
        node: '1.2.3',
        yarn: '2.3.4',
        ndk: '4.5.6',
        bun: '1.0.0',
        env: {
          SOME_ENV: '123',
        },
      },
      initiatingUserId: randomUUID(),
      appId: randomUUID(),
    };

    const { value, error } = Android.JobSchema.validate(managedJob, joiOptions);
    expect(value).toMatchObject(managedJob);
    expect(error).toBeFalsy();
  });

  test('valid job with environment', () => {
    const environments = ['production', 'preview', 'development', 'staging', 'custom-env'];

    environments.forEach((env) => {
      const jobWithEnvironment = {
        secrets,
        platform: Platform.ANDROID,
        type: Workflow.GENERIC,
        projectArchive: {
          type: ArchiveSourceType.URL,
          url: 'http://localhost:3000',
        },
        gradleCommand: ':app:bundleRelease',
        applicationArchivePath: 'android/app/build/outputs/bundle/release/app-release.aab',
        projectRootDirectory: '.',
        builderEnvironment: {
          image: 'default',
          node: '1.2.3',
          corepack: true,
          yarn: '2.3.4',
          ndk: '4.5.6',
          bun: '1.0.0',
          env: {
            SOME_ENV: '123',
          },
        },
        expoBuildUrl: 'https://expo.dev/fake/build/url',
        initiatingUserId: randomUUID(),
        appId: randomUUID(),
        environment: env,
      };

      const { value, error } = Android.JobSchema.validate(jobWithEnvironment, joiOptions);
      expect(error).toBeFalsy();
      expect(value.environment).toBe(env);
    });
  });

  test('invalid managed job', () => {
    const managedJob = {
      secrets,
      platform: Platform.ANDROID,
      type: Workflow.MANAGED,
      buildType: Android.BuildType.APP_BUNDLE,
      username: 3,
      projectArchive: {
        type: ArchiveSourceType.URL,
        url: 'url',
      },
      projectRootDirectory: '.',
      initiatingUserId: randomUUID(),
      appId: randomUUID(),
      uknownField: 'field',
    };

    const { value, error } = Android.JobSchema.validate(managedJob, joiOptions);
    expect(error?.message).toBe(
      '"projectArchive.url" must be a valid uri. "username" must be a string'
    );
    expect(value).not.toMatchObject(managedJob);
  });

  test('validates channel', () => {
    const managedJob = {
      secrets,
      type: Workflow.MANAGED,
      platform: Platform.ANDROID,
      updates: {
        channel: 'main',
      },
      projectArchive: {
        type: ArchiveSourceType.URL,
        url: 'http://localhost:3000',
      },
      projectRootDirectory: '.',
      initiatingUserId: randomUUID(),
      appId: randomUUID(),
    };

    const { value, error } = Android.JobSchema.validate(managedJob, joiOptions);
    expect(value).toMatchObject(managedJob);
    expect(error).toBeFalsy();
  });

  test('build from git without buildProfile defined', () => {
    const managedJob = {
      secrets,
      triggeredBy: BuildTrigger.GIT_BASED_INTEGRATION,
      platform: Platform.ANDROID,
      type: Workflow.MANAGED,
      buildType: Android.BuildType.APP_BUNDLE,
      username: 'turtle-tutorial',
      projectArchive: {
        type: ArchiveSourceType.GIT,
        repositoryUrl: 'http://localhost:3000',
        gitRef: 'master',
        gitCommitHash: '1b57db5b1cd12638aba0d12da71a2d691416700d',
      },
      projectRootDirectory: '.',
      builderEnvironment: {
        image: 'default',
      },
      initiatingUserId: randomUUID(),
      appId: randomUUID(),
    };

    const { error } = Android.JobSchema.validate(managedJob, joiOptions);
    expect(error?.message).toBe('"buildProfile" is required');
  });

  test('valid custom build job with path', () => {
    const customBuildJob = {
      mode: BuildMode.CUSTOM,
      type: Workflow.UNKNOWN,
      platform: Platform.ANDROID,
      projectArchive: {
        type: ArchiveSourceType.URL,
        url: 'https://expo.dev/builds/123',
      },
      projectRootDirectory: '.',
      customBuildConfig: {
        path: 'production.android.yml',
      },
      initiatingUserId: randomUUID(),
      appId: randomUUID(),
    };

    const { value, error } = Android.JobSchema.validate(customBuildJob, joiOptions);
    expect(value).toMatchObject(customBuildJob);
    expect(error).toBeFalsy();
  });

  test('valid custom build job with steps', () => {
    const customBuildJob = {
      mode: BuildMode.CUSTOM,
      type: Workflow.UNKNOWN,
      platform: Platform.ANDROID,
      projectArchive: {
        type: ArchiveSourceType.URL,
        url: 'https://expo.dev/builds/123',
      },
      projectRootDirectory: '.',
      steps: [
        {
          id: 'step1',
          name: 'Step 1',
          run: 'echo Hello, world!',
          shell: 'sh',
        },
      ],
      outputs: {},
      initiatingUserId: randomUUID(),
      appId: randomUUID(),
      workflowInterpolationContext: {
        after: {
          setup: {
            status: 'success',
            outputs: {},
          },
        },
        needs: {
          setup: {
            status: 'success',
            outputs: {},
          },
        },
        github: {
          event_name: 'push',
          sha: '123',
          ref: 'master',
          ref_name: 'master',
          ref_type: 'branch',
          commit_message: 'commit message',
          triggering_actor: 'johnny',
        },
        workflow: {
          id: randomUUID(),
          name: 'Build app',
          filename: 'build.yml',
          url: `https://expo.dev/workflows/${randomUUID()}`,
        },
      },
    };

    const { value, error } = Android.JobSchema.validate(customBuildJob, joiOptions);
    expect(value).toMatchObject(customBuildJob);
    expect(error).toBeFalsy();
  });

  test('can set github trigger options', () => {
    const job = {
      mode: BuildMode.BUILD,
      type: Workflow.UNKNOWN,
      platform: Platform.ANDROID,
      projectArchive: {
        type: ArchiveSourceType.URL,
        url: 'https://expo.dev/builds/123',
      },
      projectRootDirectory: '.',
      githubTriggerOptions: {
        autoSubmit: true,
        submitProfile: 'default',
      },
      secrets,
      initiatingUserId: randomUUID(),
      appId: randomUUID(),
    };
    const { value, error } = Android.JobSchema.validate(job, joiOptions);
    expect(value).toMatchObject(job);
    expect(error).toBeFalsy();
  });

  test('can set github trigger options', () => {
    const job = {
      mode: BuildMode.BUILD,
      type: Workflow.UNKNOWN,
      platform: Platform.ANDROID,
      projectArchive: {
        type: ArchiveSourceType.URL,
        url: 'https://expo.dev/builds/123',
      },
      projectRootDirectory: '.',
      secrets,
      loggerLevel: LoggerLevel.DEBUG,
      initiatingUserId: randomUUID(),
      appId: randomUUID(),
    };
    const { value, error } = Android.JobSchema.validate(job, joiOptions);
    expect(value).toMatchObject(job);
    expect(error).toBeFalsy();
  });

  test('can set build mode === repack with steps', () => {
    const job = {
      mode: BuildMode.REPACK,
      type: Workflow.UNKNOWN,
      platform: Platform.ANDROID,
      steps: [
        {
          id: 'step1',
          name: 'Step 1',
          run: 'echo Hello, world!',
          shell: 'sh',
        },
      ],
      outputs: {},
      projectArchive: {
        type: ArchiveSourceType.URL,
        url: 'https://expo.dev/builds/123',
      },
      projectRootDirectory: '.',
      secrets,
      initiatingUserId: randomUUID(),
      appId: randomUUID(),
    };
    const { value, error } = Android.JobSchema.validate(job, joiOptions);
    expect(value).toMatchObject(job);
    expect(error).toBeFalsy();
  });
});
