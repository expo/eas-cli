import { randomUUID } from 'crypto';

import Joi from 'joi';
import { LoggerLevel } from '@expo/logger';

import { ArchiveSourceType, BuildMode, Platform, Workflow } from '../common';
import * as Ios from '../ios';

const joiOptions: Joi.ValidationOptions = {
  stripUnknown: true,
  convert: true,
  abortEarly: false,
};

const buildCredentials: Ios.BuildCredentials = {
  testapp: {
    distributionCertificate: {
      dataBase64: 'YmluYXJ5Y29udGVudDE=',
      password: 'distCertPassword',
    },
    provisioningProfileBase64: 'MnRuZXRub2N5cmFuaWI=',
  },
};

describe('Ios.JobSchema', () => {
  test('valid generic job', () => {
    const genericJob = {
      secrets: {
        buildCredentials,
      },
      type: Workflow.GENERIC,
      platform: Platform.IOS,
      projectArchive: {
        type: ArchiveSourceType.URL,
        url: 'http://localhost:3000',
      },
      projectRootDirectory: '.',
      scheme: 'testapp',
      buildConfiguration: 'Release',
      applicationArchivePath: 'ios/build/*.ipa',
      builderEnvironment: {
        image: 'default',
        node: '1.2.3',
        corepack: true,
        yarn: '2.3.4',
        fastlane: '3.4.5',
        cocoapods: '4.5.6',
        env: {
          ENV_VAR: '123',
        },
      },
      expoBuildUrl: 'https://expo.dev/fake/build/url',
      initiatingUserId: randomUUID(),
      appId: randomUUID(),
    };

    const { value, error } = Ios.JobSchema.validate(genericJob, joiOptions);
    expect(value).toMatchObject(genericJob);
    expect(error).toBeFalsy();
  });

  test('valid resign job', () => {
    const genericJob = {
      mode: BuildMode.RESIGN,
      secrets: {
        buildCredentials,
      },
      type: Workflow.UNKNOWN,
      platform: Platform.IOS,
      projectArchive: {
        type: ArchiveSourceType.NONE,
      },
      resign: {
        applicationArchiveSource: {
          type: ArchiveSourceType.URL,
          url: 'http://localhost:3000/a.ipa',
        },
      },
      initiatingUserId: randomUUID(),
      appId: randomUUID(),
    };

    const { value, error } = Ios.JobSchema.validate(genericJob, joiOptions);
    expect(value).toMatchObject(genericJob);
    expect(error).toBeFalsy();
  });

  test('valid custom build job with metadataLocation', () => {
    const customBuildJob = {
      mode: BuildMode.CUSTOM,
      type: Workflow.UNKNOWN,
      platform: Platform.IOS,
      projectArchive: {
        type: ArchiveSourceType.GCS,
        bucketKey: 'path/to/file',
        metadataLocation: 'path/to/metadata',
      },
      projectRootDirectory: '.',
      customBuildConfig: {
        path: 'production.ios.yml',
      },
      initiatingUserId: randomUUID(),
      appId: randomUUID(),
    };

    const { value, error } = Ios.JobSchema.validate(customBuildJob, joiOptions);
    expect(value).toMatchObject(customBuildJob);
    expect(error).toBeFalsy();
  });

  test('valid custom build job', () => {
    const customBuildJob = {
      mode: BuildMode.CUSTOM,
      type: Workflow.UNKNOWN,
      platform: Platform.IOS,
      projectArchive: {
        type: ArchiveSourceType.URL,
        url: 'https://expo.dev/builds/123',
      },
      projectRootDirectory: '.',
      customBuildConfig: {
        path: 'production.ios.yml',
      },
      initiatingUserId: randomUUID(),
      appId: randomUUID(),
    };

    const { value, error } = Ios.JobSchema.validate(customBuildJob, joiOptions);
    expect(value).toMatchObject(customBuildJob);
    expect(error).toBeFalsy();
  });

  test('valid custom build job with steps', () => {
    const customBuildJob = {
      mode: BuildMode.CUSTOM,
      type: Workflow.UNKNOWN,
      platform: Platform.IOS,
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
        app: {
          id: randomUUID(),
          slug: 'example-app',
        },
        account: {
          id: randomUUID(),
          name: 'example-account',
        },
      },
    };

    const { value, error } = Ios.JobSchema.validate(customBuildJob, joiOptions);
    expect(value).toMatchObject(customBuildJob);
    expect(error).toBeFalsy();
  });

  test('invalid generic job', () => {
    const genericJob = {
      secrets: {
        buildCredentials,
      },
      type: Workflow.GENERIC,
      platform: Platform.IOS,
      projectArchive: {
        type: ArchiveSourceType.URL,
        url: 'url',
      },
      projectRootDirectory: '.',
      initiatingUserId: randomUUID(),
      appId: randomUUID(),
      uknownField: 'field',
    };

    const { value, error } = Ios.JobSchema.validate(genericJob, joiOptions);
    expect(error?.message).toBe('"projectArchive.url" must be a valid uri');
    expect(value).not.toMatchObject(genericJob);
  });

  test('valid managed job', () => {
    const managedJob = {
      secrets: {
        buildCredentials,
      },
      type: Workflow.MANAGED,
      platform: Platform.IOS,
      projectArchive: {
        type: ArchiveSourceType.URL,
        url: 'http://localhost:3000',
      },
      projectRootDirectory: '.',
      username: 'turtle-tutorial',
      builderEnvironment: {
        image: 'default',
        node: '1.2.3',
        yarn: '2.3.4',
        fastlane: '3.4.5',
        cocoapods: '4.5.6',
        env: {
          ENV_VAR: '123',
        },
      },
      initiatingUserId: randomUUID(),
      appId: randomUUID(),
    };

    const { value, error } = Ios.JobSchema.validate(managedJob, joiOptions);
    expect(value).toMatchObject(managedJob);
    expect(error).toBeFalsy();
  });

  test('valid job with none archive source type', () => {
    const managedJob = {
      secrets: {
        buildCredentials,
      },
      type: Workflow.MANAGED,
      platform: Platform.IOS,
      projectArchive: {
        type: ArchiveSourceType.NONE,
      },
      projectRootDirectory: '.',
      username: 'turtle-tutorial',
      builderEnvironment: {
        image: 'default',
        node: '1.2.3',
        yarn: '2.3.4',
        fastlane: '3.4.5',
        cocoapods: '4.5.6',
        env: {
          ENV_VAR: '123',
        },
      },
      initiatingUserId: randomUUID(),
      appId: randomUUID(),
    };

    const { value, error } = Ios.JobSchema.validate(managedJob, joiOptions);
    expect(value).toMatchObject(managedJob);
    expect(error).toBeFalsy();
  });

  test('valid job with environment', () => {
    const environments = ['production', 'preview', 'development', 'staging', 'custom-env'];

    environments.forEach((env) => {
      const jobWithEnvironment = {
        secrets: {
          buildCredentials,
        },
        type: Workflow.GENERIC,
        platform: Platform.IOS,
        projectArchive: {
          type: ArchiveSourceType.URL,
          url: 'http://localhost:3000',
        },
        projectRootDirectory: '.',
        scheme: 'testapp',
        buildConfiguration: 'Release',
        applicationArchivePath: 'ios/build/*.ipa',
        builderEnvironment: {
          image: 'default',
          node: '1.2.3',
          corepack: true,
          yarn: '2.3.4',
          fastlane: '3.4.5',
          cocoapods: '4.5.6',
          env: {
            ENV_VAR: '123',
          },
        },
        expoBuildUrl: 'https://expo.dev/fake/build/url',
        initiatingUserId: randomUUID(),
        appId: randomUUID(),
        environment: env,
      };

      const { value, error } = Ios.JobSchema.validate(jobWithEnvironment, joiOptions);
      expect(error).toBeFalsy();
      expect(value.environment).toBe(env);
    });
  });

  test('invalid managed job', () => {
    const managedJob = {
      secrets: {
        buildCredentials,
      },
      type: Workflow.MANAGED,
      platform: Platform.IOS,
      projectArchive: {
        type: ArchiveSourceType.URL,
        url: 'url',
      },
      projectRootDirectory: 312,
      initiatingUserId: randomUUID(),
      appId: randomUUID(),
      uknownField: 'field',
    };

    const { value, error } = Ios.JobSchema.validate(managedJob, joiOptions);
    expect(error?.message).toBe(
      '"projectArchive.url" must be a valid uri. "projectRootDirectory" must be a string'
    );
    expect(value).not.toMatchObject(managedJob);
  });
  test('validates channel', () => {
    const managedJob = {
      secrets: {
        buildCredentials,
      },
      type: Workflow.MANAGED,
      platform: Platform.IOS,
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

    const { value, error } = Ios.JobSchema.validate(managedJob, joiOptions);
    expect(value).toMatchObject(managedJob);
    expect(error).toBeFalsy();
  });

  test('can set github trigger options', () => {
    const job = {
      mode: BuildMode.BUILD,
      type: Workflow.UNKNOWN,
      platform: Platform.IOS,
      projectArchive: {
        type: ArchiveSourceType.URL,
        url: 'https://expo.dev/builds/123',
      },
      projectRootDirectory: '.',
      githubTriggerOptions: {
        autoSubmit: true,
        submitProfile: 'default',
      },
      secrets: {
        buildCredentials,
      },
      initiatingUserId: randomUUID(),
      appId: randomUUID(),
    };
    const { value, error } = Ios.JobSchema.validate(job, joiOptions);
    expect(value).toMatchObject(job);
    expect(error).toBeFalsy();
  });

  test('can set loggerLevel', () => {
    const job = {
      mode: BuildMode.BUILD,
      type: Workflow.UNKNOWN,
      platform: Platform.IOS,
      projectArchive: {
        type: ArchiveSourceType.URL,
        url: 'https://expo.dev/builds/123',
      },
      projectRootDirectory: '.',
      secrets: {
        buildCredentials,
      },
      loggerLevel: LoggerLevel.INFO,
      initiatingUserId: randomUUID(),
      appId: randomUUID(),
    };
    const { value, error } = Ios.JobSchema.validate(job, joiOptions);
    expect(value).toMatchObject(job);
    expect(error).toBeFalsy();
  });

  test('can set build mode === repack with steps', () => {
    const job = {
      mode: BuildMode.REPACK,
      type: Workflow.UNKNOWN,
      platform: Platform.IOS,
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
      secrets: {
        buildCredentials,
      },
      initiatingUserId: randomUUID(),
      appId: randomUUID(),
    };
    const { value, error } = Ios.JobSchema.validate(job, joiOptions);
    expect(value).toMatchObject(job);
    expect(error).toBeFalsy();
  });
});
