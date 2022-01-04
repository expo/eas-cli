import { getConfig } from '@expo/config';
import { Platform, Workflow } from '@expo/eas-build-job';
import { EasJson, EasJsonReader } from '@expo/eas-json';
import fs from 'fs-extra';

import Log from '../log';
import { RequestedPlatform } from '../platform';
import { resolveWorkflowAsync } from '../project/workflow';
import { easCliVersion } from '../utils/easCli';
import { getVcsClient } from '../vcs';
import { configureAndroidAsync } from './android/configure';
import { ConfigureContext } from './context';
import { configureIosAsync } from './ios/configure';
import { maybeBailOnRepoStatusAsync, reviewAndCommitChangesAsync } from './utils/repository';

interface ConfigureParams {
  projectDir: string;
  requestedPlatform: RequestedPlatform;
  nonInteractive: boolean;
}

const configureCommitMessage = {
  [RequestedPlatform.Android]: 'Configure EAS Build for Android',
  [RequestedPlatform.Ios]: 'Configure EAS Build for iOS',
  [RequestedPlatform.All]: 'Configure EAS Build',
};

export async function ensureProjectConfiguredAsync(
  configureParams: ConfigureParams
): Promise<void> {
  if (await fs.pathExists(EasJsonReader.formatEasJsonPath(configureParams.projectDir))) {
    return;
  }

  Log.log('This project is not configured to build with EAS. Setting it up...');
  await configureAsync(configureParams);
}

async function configureAsync({
  projectDir,
  requestedPlatform,
  nonInteractive,
}: ConfigureParams): Promise<void> {
  await maybeBailOnRepoStatusAsync();

  const { exp } = getConfig(projectDir, { skipSDKVersionRequirement: true });

  const ctx: ConfigureContext = {
    projectDir,
    exp,
    hasAndroidNativeProject:
      (await resolveWorkflowAsync(projectDir, Platform.ANDROID)) === Workflow.GENERIC,
    hasIosNativeProject:
      (await resolveWorkflowAsync(projectDir, Platform.IOS)) === Workflow.GENERIC,
  };

  Log.newLine();
  await ensureEasJsonExistsAsync(ctx);
  if ([RequestedPlatform.All, RequestedPlatform.Android].includes(requestedPlatform)) {
    await configureAndroidAsync(ctx);
  }
  if ([RequestedPlatform.All, RequestedPlatform.Ios].includes(requestedPlatform)) {
    await configureIosAsync(ctx);
  }

  if (await getVcsClient().isCommitRequiredAsync()) {
    Log.newLine();
    await reviewAndCommitChangesAsync(configureCommitMessage[requestedPlatform], {
      nonInteractive,
    });
  }
}

const EAS_JSON_MANAGED_DEFAULT: EasJson = {
  cli: {
    version: `>= ${easCliVersion}`,
  },
  build: {
    development: {
      developmentClient: true,
      distribution: 'internal',
    },
    preview: {
      distribution: 'internal',
    },
    production: {},
  },
  submit: {
    production: {},
  },
};

const EAS_JSON_BARE_DEFAULT: EasJson = {
  cli: {
    version: `>= ${easCliVersion}`,
  },
  build: {
    development: {
      distribution: 'internal',
      android: {
        gradleCommand: ':app:assembleDebug',
      },
      ios: {
        buildConfiguration: 'Debug',
      },
    },
    preview: {
      distribution: 'internal',
    },
    production: {},
  },
  submit: {
    production: {},
  },
};

export async function ensureEasJsonExistsAsync(ctx: ConfigureContext): Promise<void> {
  const easJsonPath = EasJsonReader.formatEasJsonPath(ctx.projectDir);

  if (await fs.pathExists(easJsonPath)) {
    const reader = new EasJsonReader(ctx.projectDir);
    await reader.readAsync();

    Log.withTick('Validated eas.json');
    return;
  }

  const easJson =
    ctx.hasAndroidNativeProject || ctx.hasIosNativeProject
      ? EAS_JSON_BARE_DEFAULT
      : EAS_JSON_MANAGED_DEFAULT;

  await fs.writeFile(easJsonPath, `${JSON.stringify(easJson, null, 2)}\n`);
  await getVcsClient().trackFileAsync(easJsonPath);
  Log.withTick('Generated eas.json');
}
