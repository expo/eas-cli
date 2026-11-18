import { LoggerLevel } from '@expo/logger';
import { randomUUID } from 'crypto';
import Joi from 'joi';

import {
  ArchiveSourceType,
  BuildMode,
  BuildTrigger,
  NativeBuilder,
  Platform,
  Workflow,
} from '../common';
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

function createNativeJob(overrides: object = {}): Record<string, unknown> {
  return {
    mode: BuildMode.BUILD,
    builder: NativeBuilder.XCODE,
    type: Workflow.GENERIC,
    triggeredBy: BuildTrigger.GIT_BASED_INTEGRATION,
    platform: Platform.IOS,
    projectArchive: {
      type: ArchiveSourceType.GIT,
      gitCommitHash: '0123456789abcdef0123456789abcdef01234567',
      gitRef: 'refs/heads/main',
    },
    projectRootDirectory: '.',
    simulator: false,
    secrets: {
      credentialsByBundleIdentifier: {
        'com.example.testapp': buildCredentials.testapp,
        'com.example.testapp.widget': buildCredentials.testapp,
      },
    },
    initiatingUserId: randomUUID(),
    appId: randomUUID(),
    ...overrides,
  };
}

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
      experimental: {
        uploadSourceMaps: true,
      },
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
      outputs: {
        resign_job: 'true',
      },
    };

    const { value, error } = Ios.JobSchema.validate(genericJob, joiOptions);
    expect(value).toMatchObject(genericJob);
    expect(error).toBeFalsy();
  });

  test('valid generic job with hooks', () => {
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
      initiatingUserId: randomUUID(),
      appId: randomUUID(),
    };

    const { value, error } = Ios.JobSchema.validate(genericJob, joiOptions);
    expect(value).toMatchObject(genericJob);
    expect(error).toBeFalsy();
  });

  test('valid resign job with hooks', () => {
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
      hooks: {
        before_install_node_modules: [],
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
      outputs: {
        ios_build_type: 'simulator',
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

  test('preserves outputs for build jobs', () => {
    const job = {
      mode: BuildMode.BUILD,
      type: Workflow.UNKNOWN,
      platform: Platform.IOS,
      projectArchive: {
        type: ArchiveSourceType.URL,
        url: 'https://expo.dev/builds/123',
      },
      projectRootDirectory: '.',
      outputs: {
        ios_build_type: 'simulator',
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

    environments.forEach(env => {
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

  test('accepts optional refreshAdHocProvisioningProfile', () => {
    const job = {
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
      initiatingUserId: randomUUID(),
      appId: randomUUID(),
      refreshAdHocProvisioningProfile: true,
    };

    const { value, error } = Ios.JobSchema.validate(job, joiOptions);
    expect(value.refreshAdHocProvisioningProfile).toBe(true);
    expect(error).toBeFalsy();
  });

  test('does not require refreshAdHocProvisioningProfile', () => {
    const job = {
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
      initiatingUserId: randomUUID(),
      appId: randomUUID(),
    };

    const { value, error } = Ios.JobSchema.validate(job, joiOptions);
    expect(value.refreshAdHocProvisioningProfile).toBeUndefined();
    expect(error).toBeFalsy();
  });

  test('returns a valid native job unchanged', () => {
    const job = createNativeJob({
      scheme: 'testapp',
      buildConfiguration: 'Release',
      projectFile: 'testapp.xcworkspace',
      hooks: { after_checkout: [{ run: 'echo Hello, world!' }] },
    });

    const { value, error } = Ios.JobSchema.validate(job, joiOptions);
    expect(error).toBeFalsy();
    expect(value).toEqual(job);
  });

  test('returns a valid native simulator job without credentials unchanged', () => {
    const job = createNativeJob({ simulator: true, secrets: {} });

    const { value, error } = Ios.JobSchema.validate(job, joiOptions);
    expect(error).toBeFalsy();
    expect(value).toEqual(job);
  });

  test('native job requires simulator', () => {
    const job = createNativeJob({ simulator: undefined });

    const { error } = Ios.JobSchema.validate(job, joiOptions);
    expect(error?.message).toBe('"simulator" is required');
  });

  test('native job defaults mode to build', () => {
    const job = createNativeJob({ mode: undefined });

    const { value, error } = Ios.JobSchema.validate(job, joiOptions);
    expect(error).toBeFalsy();
    expect(value.mode).toBe(BuildMode.BUILD);
  });

  test.each([BuildMode.RESIGN, BuildMode.CUSTOM, BuildMode.REPACK])(
    'native job rejects mode %s',
    mode => {
      const job = createNativeJob({ mode });

      const { error } = Ios.JobSchema.validate(job, joiOptions);
      expect(error?.message).toBe('"mode" must be [build]');
    }
  );

  test('job without builder is not a native job', () => {
    const job = createNativeJob({ builder: undefined, buildProfile: 'production' });

    const { value, error } = Ios.JobSchema.validate(job, joiOptions);
    expect(error).toBeFalsy();
    expect(value.buildProfile).toBe('production');
  });

  test.each([false, true])('native job requires secrets (simulator: %s)', simulator => {
    const job = createNativeJob({ simulator, secrets: undefined });

    const { error } = Ios.JobSchema.validate(job, joiOptions);
    expect(error?.message).toBe('"secrets" is required');
  });

  test('native job requires credentialsByBundleIdentifier when it does not build for a simulator', () => {
    const job = createNativeJob({ secrets: {} });

    const { error } = Ios.JobSchema.validate(job, joiOptions);
    expect(error?.message).toBe('"secrets.credentialsByBundleIdentifier" is required');
  });

  test('native job rejects an incomplete credentialsByBundleIdentifier entry', () => {
    const job = createNativeJob({
      secrets: {
        credentialsByBundleIdentifier: {
          'com.example.testapp': {
            distributionCertificate: buildCredentials.testapp.distributionCertificate,
          },
        },
      },
    });

    const { error } = Ios.JobSchema.validate(job, joiOptions);
    expect(error?.message).toBe(
      '"secrets.credentialsByBundleIdentifier.com.example.testapp.provisioningProfileBase64" is required'
    );
  });

  test.each([false, true])(
    'native job rejects an empty credentialsByBundleIdentifier (simulator: %s)',
    simulator => {
      const job = createNativeJob({ simulator, secrets: { credentialsByBundleIdentifier: {} } });

      const { error } = Ios.JobSchema.validate(job, joiOptions);
      expect(error?.message).toBe(
        '"secrets.credentialsByBundleIdentifier" must have at least 1 key'
      );
    }
  );

  test('native job rejects secrets.buildCredentials', () => {
    const job = createNativeJob({
      secrets: {
        buildCredentials,
        credentialsByBundleIdentifier: { 'com.example.testapp': buildCredentials.testapp },
      },
    });

    const { error } = Ios.JobSchema.validate(job, joiOptions);
    expect(error?.message).toBe('"secrets.buildCredentials" is not allowed');
  });

  test('native job rejects a type other than generic', () => {
    const job = createNativeJob({ type: Workflow.MANAGED });

    const { error } = Ios.JobSchema.validate(job, joiOptions);
    expect(error?.message).toBe('"type" must be [generic]');
  });

  test.each([NativeBuilder.GRADLE, 'unknown'])('native job rejects builder %s', builder => {
    const job = createNativeJob({ builder });

    const { error } = Ios.JobSchema.validate(job, joiOptions);
    expect(error?.message).toBe('"builder" must be [xcode]');
  });

  test.each([
    ['buildProfile', 'production'],
    ['updates', { channel: 'main' }],
    ['cache', { disabled: false }],
    ['developmentClient', true],
    ['version', { buildNumber: '1' }],
    ['buildArtifactPaths', ['ios/build/*.log']],
    ['applicationArchivePath', 'ios/build/*.ipa'],
    ['username', 'testuser'],
    ['customBuildConfig', { path: 'production.yml' }],
    ['steps', [{ id: 'step1', run: 'echo Hello, world!', shell: 'sh' }]],
    ['outputs', { build_number: '1' }],
    ['experimental', { prebuildCommand: 'echo Hello, world!' }],
    ['githubTriggerOptions', { autoSubmit: true }],
    [
      'resign',
      { applicationArchiveSource: { type: ArchiveSourceType.URL, url: 'http://localhost:3000' } },
    ],
    ['refreshAdHocProvisioningProfile', true],
  ])('native job rejects %s', (field, fieldValue) => {
    const job = createNativeJob({ [field]: fieldValue });

    const { error } = Ios.JobSchema.validate(job, joiOptions);
    expect(error?.message).toBe(`"${field}" is not allowed`);
  });

  test('native job accepts only the job fields listed here', () => {
    const { keys } = Ios.JobSchema.describe().whens[0].then;
    const acceptedFields = Object.keys(keys).filter(
      field => keys[field].flags?.presence !== 'forbidden'
    );

    expect(new Set(acceptedFields)).toEqual(
      new Set([
        'mode',
        'type',
        'triggeredBy',
        'projectArchive',
        'platform',
        'projectRootDirectory',
        'builderEnvironment',
        'scheme',
        'buildConfiguration',
        'hooks',
        'ssh',
        'expoBuildUrl',
        'loggerLevel',
        'initiatingUserId',
        'appId',
        'environment',
        'workflowInterpolationContext',
        'builder',
        'simulator',
        'secrets',
        'projectFile',
      ])
    );
  });
});
