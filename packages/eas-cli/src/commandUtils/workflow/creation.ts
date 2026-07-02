import { ExpoConfig, getPackageJson } from '@expo/config';
import { Platform, Workflow } from '@expo/eas-build-job';
import chalk from 'chalk';

import {
  DEVELOPMENT_BUILD_PROFILE_NAME,
  DEVELOPMENT_IOS_SIMULATOR_BUILD_PROFILE_NAME,
  addProductionBuildProfileToEasJsonIfNeededAsync,
  ensureDevelopmentBuildProfilesExistAsync,
  hasBuildConfigureBeenRunAsync,
  hasUpdateConfigureBeenRunAsync,
} from './buildProfileUtils';
import { ExpoGraphqlClient } from '../context/contextUtils/createGraphqlClient';
import Log, { link } from '../../log';
import { ensureApplicationIdIsDefinedForManagedProjectAsync } from '../../project/android/applicationId';
import { ensureBundleIdentifierIsDefinedForManagedProjectAsync } from '../../project/ios/bundleIdentifier';
import { resolveWorkflowAsync } from '../../project/workflow';
import { easCliVersion } from '../../utils/easCli';
import { expoCommandAsync } from '../../utils/expoCli';
import { Client } from '../../vcs/vcs';

export enum WorkflowStarterName {
  BUILD = 'build',
  UPDATE = 'update',
  CUSTOM = 'custom',
  DEPLOY = 'deploy',
}

export type WorkflowStarter = {
  name: WorkflowStarterName;
  displayName: string;
  defaultFileName: string;
  template: any;
  header: string;
  nextSteps?: string[];
};

const createdByEASCLI = `# Created by EAS CLI v${easCliVersion}`;

/**
 * Placeholder workflow written when a user runs `eas workflow:create <name>` with a file name
 * but without picking a template.
 */
export const PLACEHOLDER_WORKFLOW_CONTENTS = `name: # Workflow name

on: # Add triggers https://docs.expo.dev/eas/workflows/syntax/#on

jobs: # Add pre-packaged jobs http://docs.expo.dev/eas/workflows/pre-packaged-jobs/. See all syntax https://docs.expo.dev/eas/workflows/syntax/#jobs.
`;

const CUSTOM_TEMPLATE = {
  name: 'Custom workflow',
  on: {
    push: {
      branches: ['main'],
    },
  },
  jobs: {
    custom_build: {
      name: 'Custom job',
      steps: [
        {
          uses: 'eas/checkout',
        },
        {
          name: 'Hello World',
          id: 'hello_world',
          run: '# Custom script\necho "Hello, World"\n',
        },
      ],
    },
  },
};

const CUSTOM_TEMPLATE_HEADER = `
# Custom workflow
#
# Runs eas/checkout, then a custom shell command. Triggered on pushes to "main".
# Learn more: https://docs.expo.dev/eas/workflows/syntax/
#
${createdByEASCLI}
`;

const BUILD_TEMPLATE = {
  name: 'Create development builds',
  jobs: {
    android_development_build: {
      name: 'Build Android',
      type: 'build',
      params: {
        platform: 'android',
        profile: DEVELOPMENT_BUILD_PROFILE_NAME,
      },
    },
    ios_device_development_build: {
      name: 'Build iOS device',
      type: 'build',
      params: {
        platform: 'ios',
        profile: DEVELOPMENT_BUILD_PROFILE_NAME,
      },
    },
    ios_simulator_development_build: {
      name: 'Build iOS simulator',
      type: 'build',
      params: {
        platform: 'ios',
        profile: DEVELOPMENT_IOS_SIMULATOR_BUILD_PROFILE_NAME,
      },
    },
  },
};

const BUILD_TEMPLATE_HEADER = `
# Create development builds
#
# Builds Android and iOS development builds for devices and simulators.
# Learn more: https://docs.expo.dev/develop/development-builds/introduction/
#
${createdByEASCLI}
`;

const PUBLISH_UPDATE_TEMPLATE = {
  name: 'Publish update',
  jobs: {
    publish_update: {
      name: 'Publish update',
      type: 'update',
      params: {
        branch: '${{ github.ref_name || "main" }}',
      },
    },
  },
};

const PUBLISH_UPDATE_TEMPLATE_HEADER = `
# Publish update
#
# Publishes an EAS Update to the current branch.
# Learn more: https://docs.expo.dev/eas/workflows/examples/publish-preview-update/
#
${createdByEASCLI}
`;

const DEPLOY_TEMPLATE = {
  name: 'Deploy to production',
  on: {
    push: {
      branches: ['main'],
    },
  },
  jobs: {
    fingerprint: {
      name: 'Fingerprint',
      type: 'fingerprint',
    },
    get_android_build: {
      name: 'Check for existing android build',
      needs: ['fingerprint'],
      type: 'get-build',
      params: {
        fingerprint_hash: '${{ needs.fingerprint.outputs.android_fingerprint_hash }}',
        profile: 'production',
      },
    },
    get_ios_build: {
      name: 'Check for existing ios build',
      needs: ['fingerprint'],
      type: 'get-build',
      params: {
        fingerprint_hash: '${{ needs.fingerprint.outputs.ios_fingerprint_hash }}',
        profile: 'production',
      },
    },
    build_android: {
      name: 'Build Android',
      needs: ['get_android_build'],
      if: '${{ !needs.get_android_build.outputs.build_id }}',
      type: 'build',
      params: {
        platform: 'android',
        profile: 'production',
      },
    },
    build_ios: {
      name: 'Build iOS',
      needs: ['get_ios_build'],
      if: '${{ !needs.get_ios_build.outputs.build_id }}',
      type: 'build',
      params: {
        platform: 'ios',
        profile: 'production',
      },
    },
    submit_android_build: {
      name: 'Submit Android Build',
      needs: ['build_android'],
      type: 'submit',
      params: {
        build_id: '${{ needs.build_android.outputs.build_id }}',
      },
    },
    submit_ios_build: {
      name: 'Submit iOS Build',
      needs: ['build_ios'],
      type: 'submit',
      params: {
        build_id: '${{ needs.build_ios.outputs.build_id }}',
      },
    },
    publish_android_update: {
      name: 'Publish Android update',
      needs: ['get_android_build'],
      if: '${{ needs.get_android_build.outputs.build_id }}',
      type: 'update',
      params: {
        branch: 'production',
        platform: 'android',
      },
    },
    publish_ios_update: {
      name: 'Publish iOS update',
      needs: ['get_ios_build'],
      if: '${{ needs.get_ios_build.outputs.build_id }}',
      type: 'update',
      params: {
        branch: 'production',
        platform: 'ios',
      },
    },
  },
};

const DEPLOY_TEMPLATE_HEADER = `
# Deploy to production
#
# Builds and submits to the app stores, or sends an over-the-air update when there are no native changes.
# Triggered on pushes to "main".
# Learn more: https://docs.expo.dev/eas/workflows/examples/deploy-to-production/
#
${createdByEASCLI}
`;

function nextStepForDeviceBuildProfile(buildProfileName: string): string {
  return `Building for real devices with the "${buildProfileName}" profile may require credentials. Set them up with ${chalk.bold(
    'eas credentials'
  )}. Learn more: ${link('https://docs.expo.dev/app-signing/app-credentials/')}`;
}

function nextStepForAppSubmission(): string {
  return `Submitting to the app stores requires App Store and Play Store credentials. Learn more: ${link(
    'https://docs.expo.dev/deploy/submit-to-app-stores/'
  )}`;
}

export function howToRunWorkflow(
  workflowFileName: string,
  workflowStarter: WorkflowStarter
): string {
  let line = `Run this workflow with ${chalk.bold(`eas workflow:run ${workflowFileName}`)}.`;
  const branches = workflowStarter.template?.on?.push?.branches;
  if (Array.isArray(branches) && branches.length > 0) {
    if (branches.length === 1 && branches[0] === '*') {
      line += ' It also runs automatically when code is pushed to any branch.';
    } else if (branches.length === 1) {
      line += ` It also runs automatically when code is pushed to the "${branches[0]}" branch.`;
    } else {
      line += ` It also runs automatically when code is pushed to: ${branches.join(', ')}.`;
    }
  }
  return line;
}

export const workflowStarters: WorkflowStarter[] = [
  {
    displayName: 'Custom',
    name: WorkflowStarterName.CUSTOM,
    defaultFileName: 'custom.yml',
    template: CUSTOM_TEMPLATE,
    header: CUSTOM_TEMPLATE_HEADER,
  },
  {
    displayName: 'Create development builds',
    name: WorkflowStarterName.BUILD,
    defaultFileName: 'build.yml',
    template: BUILD_TEMPLATE,
    header: BUILD_TEMPLATE_HEADER,
  },
  {
    displayName: 'Publish updates',
    name: WorkflowStarterName.UPDATE,
    defaultFileName: 'update.yml',
    template: PUBLISH_UPDATE_TEMPLATE,
    header: PUBLISH_UPDATE_TEMPLATE_HEADER,
  },
  {
    displayName: 'Deploy to production',
    name: WorkflowStarterName.DEPLOY,
    defaultFileName: 'deploy.yml',
    template: DEPLOY_TEMPLATE,
    header: DEPLOY_TEMPLATE_HEADER,
  },
];

/**
 * Sets up the project for the "Create development builds" workflow:
 * - Ensures app identifiers (android.package, ios.bundleIdentifier) are defined, which are
 *   required for builds triggered by the GitHub integration.
 * - Ensures the development build profiles exist in eas.json.
 * - Ensures expo-dev-client is installed.
 */
async function setUpDevelopmentBuildTemplateAsync({
  workflowStarter,
  projectDir,
  expoConfig,
  graphqlClient,
  projectId,
  vcsClient,
}: {
  workflowStarter: WorkflowStarter;
  projectDir: string;
  expoConfig: ExpoConfig;
  graphqlClient: ExpoGraphqlClient;
  projectId: string;
  vcsClient: Client;
}): Promise<WorkflowStarter> {
  await ensureAppIdentifiersAreDefinedAsync({
    graphqlClient,
    projectDir,
    projectId,
    exp: expoConfig,
    vcsClient,
  });
  await ensureDevelopmentBuildProfilesExistAsync(projectDir);
  await ensureExpoDevClientInstalledAsync(projectDir);
  workflowStarter.nextSteps = [nextStepForDeviceBuildProfile(DEVELOPMENT_BUILD_PROFILE_NAME)];
  return workflowStarter;
}

/**
 * Ensures the app identifiers are set in the app config for managed projects. Builds triggered by
 * the GitHub integration require "android.package" and "ios.bundleIdentifier" to be set.
 */
async function ensureAppIdentifiersAreDefinedAsync({
  graphqlClient,
  projectDir,
  projectId,
  exp,
  vcsClient,
}: {
  graphqlClient: ExpoGraphqlClient;
  projectDir: string;
  projectId: string;
  exp: ExpoConfig;
  vcsClient: Client;
}): Promise<void> {
  const androidWorkflow = await resolveWorkflowAsync(projectDir, Platform.ANDROID, vcsClient);
  if (androidWorkflow === Workflow.MANAGED) {
    await ensureApplicationIdIsDefinedForManagedProjectAsync({
      graphqlClient,
      projectDir,
      projectId,
      exp,
      vcsClient,
      nonInteractive: false,
    });
  }
  const iosWorkflow = await resolveWorkflowAsync(projectDir, Platform.IOS, vcsClient);
  if (iosWorkflow === Workflow.MANAGED) {
    await ensureBundleIdentifierIsDefinedForManagedProjectAsync({
      graphqlClient,
      projectDir,
      projectId,
      exp,
      vcsClient,
      nonInteractive: false,
    });
  }
}

async function ensureExpoDevClientInstalledAsync(projectDir: string): Promise<void> {
  const packageJson = getPackageJson(projectDir);
  const isInstalled = !!(packageJson.dependencies && 'expo-dev-client' in packageJson.dependencies);
  if (isInstalled) {
    return;
  }
  Log.log('Installing expo-dev-client...');
  await expoCommandAsync(projectDir, ['install', 'expo-dev-client']);
}

export async function ensureProductionBuildProfileExistsAsync(
  projectDir: string,
  workflowStarter: WorkflowStarter
): Promise<WorkflowStarter> {
  await addProductionBuildProfileToEasJsonIfNeededAsync(projectDir);
  workflowStarter.nextSteps = [
    nextStepForDeviceBuildProfile('production'),
    nextStepForAppSubmission(),
  ];
  return workflowStarter;
}

export async function customizeTemplateIfNeededAsync({
  workflowStarter,
  projectDir,
  expoConfig,
  graphqlClient,
  projectId,
  vcsClient,
}: {
  workflowStarter: WorkflowStarter;
  projectDir: string;
  expoConfig: ExpoConfig;
  graphqlClient: ExpoGraphqlClient;
  projectId: string;
  vcsClient: Client;
}): Promise<WorkflowStarter> {
  // Ensure EAS Build is configured
  switch (workflowStarter.name) {
    case WorkflowStarterName.BUILD:
    case WorkflowStarterName.DEPLOY:
    case WorkflowStarterName.UPDATE:
      if (!(await hasBuildConfigureBeenRunAsync({ projectDir, expoConfig }))) {
        throw new Error(
          'EAS Build is not configured for this project. Please run "eas build:configure" to configure it.'
        );
      }
      break;
    default:
      break;
  }
  // Ensure EAS Update is configured
  switch (workflowStarter.name) {
    case WorkflowStarterName.DEPLOY:
    case WorkflowStarterName.UPDATE:
      if (!(await hasUpdateConfigureBeenRunAsync({ projectDir, expoConfig }))) {
        throw new Error(
          'EAS Update is not configured for this project. Please run "eas update:configure" to configure it.'
        );
      }
      break;
    default:
      break;
  }
  // Customize template
  switch (workflowStarter.name) {
    case WorkflowStarterName.BUILD:
      Log.debug('Setting up development builds workflow...');
      return await setUpDevelopmentBuildTemplateAsync({
        workflowStarter,
        projectDir,
        expoConfig,
        graphqlClient,
        projectId,
        vcsClient,
      });
    case WorkflowStarterName.DEPLOY:
      return await ensureProductionBuildProfileExistsAsync(projectDir, workflowStarter);
    default:
      return workflowStarter;
  }
}
