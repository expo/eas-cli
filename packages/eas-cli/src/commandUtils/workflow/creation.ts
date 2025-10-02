import { ExpoConfig } from '@expo/config';
import { Platform } from '@expo/eas-build-job';

import {
  addAndroidDevelopmentBuildProfileToEasJsonAsync,
  addIosDevelopmentBuildProfileToEasJsonAsync,
  buildProfilesFromProjectAsync,
  isBuildProfileForDevelopment,
  isIosBuildProfileForSimulator,
} from './buildProfileUtils';
import Log from '../../log';
import { confirmAsync } from '../../prompts';
import { easCliVersion } from '../../utils/easCli';

export enum WorkflowStarterName {
  BUILD = 'build',
  UPDATE = 'update',
  CUSTOM = 'custom',
}

export type WorkflowStarter = {
  name: WorkflowStarterName;
  displayName: string;
  defaultFileName: string;
  template: any;
  header: string;
};

const createdByEASCLI = `# Created by EAS CLI v${easCliVersion}`;

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
# Custom job
#
# This workflow shows how to write custom jobs.
# It contains a predefined workflow step and a shell command to print "Hello, World!".
#
# Key features:
# - Triggers on pushes to the main branch.
#    (Requires linked GitHub account: https://expo.dev/accounts/[account]/settings/github)
# - Can be triggered manually with eas workflow:run custom.yml
# - Runs eas/checkout then a custom "echo" command
#
# For detailed documentation on workflow syntax and available step types, visit:
# https://docs.expo.dev/eas/workflows/syntax/#jobsjob_idstepsstepuses
#
${createdByEASCLI}
#
`;

const BUILD_TEMPLATE = {
  name: 'Create development builds',
  on: {
    push: {
      branches: ['main'],
    },
  },
  jobs: {},
};

const BUILD_TEMPLATE_HEADER = `
# Create development builds
#
# This workflow shows how to create development builds.
#
# Key features:
# - Can be triggered manually with eas workflow:run create-development-builds.yml
# - Runs the pre-packaged build job to create Android and iOS development builds
#     for Android emulators, Android and iOS devices, and iOS simulators
#
# For a detailed guide on using this workflow, visit:
# https://docs.expo.dev/develop/development-builds/introduction/
#
${createdByEASCLI}
#
`;

const PUBLISH_UPDATE_TEMPLATE = {
  name: 'Publish preview update',
  on: {
    push: {
      branches: ['*'],
    },
  },
  jobs: {
    publish_preview_update: {
      name: 'Publish preview update',
      type: 'update',
      params: {
        branch: '${{ github.ref_name || "test" }}',
      },
    },
  },
};

const PUBLISH_UPDATE_TEMPLATE_HEADER = `
# Publish preview update
#
# This workflow shows how to publish preview updates.
# Learn more: https://docs.expo.dev/review/share-previews-with-your-team/
#
# Key features:
# - Triggers on pushes to all branches
#    (Requires linked GitHub account: https://expo.dev/accounts/[account]/settings/github)
# - Can be triggered manually with eas workflow:run publish-preview-update.yml
# - Runs the pre-packaged update job
#
# For a detailed guide on using this workflow, visit:
# https://docs.expo.dev/eas/workflows/examples/publish-preview-update/
#
${createdByEASCLI}
#
`;

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
    defaultFileName: 'create-development-builds.yml',
    template: BUILD_TEMPLATE,
    header: BUILD_TEMPLATE_HEADER,
  },
  {
    displayName: 'Publish updates',
    name: WorkflowStarterName.UPDATE,
    defaultFileName: 'publish-updates.yml',
    template: PUBLISH_UPDATE_TEMPLATE,
    header: PUBLISH_UPDATE_TEMPLATE_HEADER,
  },
];

export async function addBuildJobsToDevelopmentBuildTemplateAsync(
  projectDir: string,
  workflowTemplate: WorkflowStarter
): Promise<WorkflowStarter> {
  const buildProfiles = await buildProfilesFromProjectAsync(projectDir);
  // android_development_build

  let androidDevelopmentBuildProfileName: string | null = null;
  for (const profileName of buildProfiles.keys()) {
    const profile = buildProfiles.get(profileName)?.android;
    if (!profile) {
      continue;
    }
    if (isBuildProfileForDevelopment(profile, Platform.ANDROID)) {
      androidDevelopmentBuildProfileName = profileName;
      break;
    }
  }
  if (!androidDevelopmentBuildProfileName) {
    Log.warn(
      'This workflow requires an Android development build profile in your eas.json, but none were found.'
    );
    const add = await confirmAsync({
      message: 'Do you want to add an Android development build profile?',
      initial: false,
    });
    if (add) {
      let androidDevelopmentBuildProfileName = 'android_development';
      while (buildProfiles.has(androidDevelopmentBuildProfileName)) {
        androidDevelopmentBuildProfileName = `${androidDevelopmentBuildProfileName}_1`;
      }
      await addAndroidDevelopmentBuildProfileToEasJsonAsync(
        projectDir,
        androidDevelopmentBuildProfileName
      );
    } else {
      Log.log('Skipping Android development build job...');
    }
  }
  if (androidDevelopmentBuildProfileName) {
    Log.log(`Using Android development build profile: ${androidDevelopmentBuildProfileName}`);
    workflowTemplate.template.jobs.android_development_build = {
      name: `Build ${androidDevelopmentBuildProfileName} for android`,
      type: 'build',
      params: {
        profile: androidDevelopmentBuildProfileName,
        platform: 'android',
      },
    };
  }

  // ios_simulator_development_build
  let iosSimulatorDevelopmentBuildProfileName: string | null = null;
  for (const profileName of buildProfiles.keys()) {
    const profile = buildProfiles.get(profileName)?.ios;
    if (!profile) {
      continue;
    }
    if (
      isBuildProfileForDevelopment(profile, Platform.IOS) &&
      isIosBuildProfileForSimulator(profile)
    ) {
      iosSimulatorDevelopmentBuildProfileName = profileName;
      break;
    }
  }
  if (!iosSimulatorDevelopmentBuildProfileName) {
    Log.warn(
      'This workflow requires an iOS simulator development build profile in your eas.json, but none were found.'
    );
    const add = await confirmAsync({
      message: 'Do you want to add an iOS simulator development build profile?',
      initial: false,
    });
    if (add) {
      let iosSimulatorDevelopmentBuildProfileName = 'ios_simulator_development';
      while (buildProfiles.has(iosSimulatorDevelopmentBuildProfileName)) {
        iosSimulatorDevelopmentBuildProfileName = `${iosSimulatorDevelopmentBuildProfileName}_1`;
      }
      await addIosDevelopmentBuildProfileToEasJsonAsync(
        projectDir,
        iosSimulatorDevelopmentBuildProfileName,
        true
      );
    } else {
      Log.log('Skipping iOS simulator development build job...');
    }
  }
  if (iosSimulatorDevelopmentBuildProfileName) {
    Log.log(
      `Using iOS simulator development build profile: ${iosSimulatorDevelopmentBuildProfileName}`
    );
    workflowTemplate.template.jobs.ios_simulator_development_build = {
      name: `Build ${iosSimulatorDevelopmentBuildProfileName} for iOS simulator`,
      type: 'build',
      params: {
        profile: iosSimulatorDevelopmentBuildProfileName,
        platform: 'ios',
      },
    };
  }
  // ios_device_development_build
  let iosDeviceDevelopmentBuildProfileName: string | null = null;
  for (const profileName of buildProfiles.keys()) {
    const profile = buildProfiles.get(profileName)?.ios;
    if (!profile) {
      continue;
    }
    if (
      isBuildProfileForDevelopment(profile, Platform.IOS) &&
      !isIosBuildProfileForSimulator(profile)
    ) {
      iosDeviceDevelopmentBuildProfileName = profileName;
      break;
    }
  }
  if (!iosDeviceDevelopmentBuildProfileName) {
    Log.warn(
      'This workflow requires an iOS device development build profile in your eas.json, but none were found.'
    );
    const add = await confirmAsync({
      message: 'Do you want to add an iOS device development build profile?',
      initial: false,
    });
    if (add) {
      let iosDeviceDevelopmentBuildProfileName = 'ios_device_development';
      while (buildProfiles.has(iosDeviceDevelopmentBuildProfileName)) {
        iosDeviceDevelopmentBuildProfileName = `${iosDeviceDevelopmentBuildProfileName}_1`;
      }
      await addIosDevelopmentBuildProfileToEasJsonAsync(
        projectDir,
        iosDeviceDevelopmentBuildProfileName,
        false
      );
    } else {
      Log.log('Skipping iOS device development build job...');
    }
  }
  if (iosDeviceDevelopmentBuildProfileName) {
    Log.log(`Using iOS device development build profile: ${iosDeviceDevelopmentBuildProfileName}`);
    workflowTemplate.template.jobs.ios_development_build = {
      name: `Build ${iosDeviceDevelopmentBuildProfileName} for iOS simulator`,
      type: 'build',
      params: {
        profile: iosDeviceDevelopmentBuildProfileName,
        platform: 'ios',
      },
    };
  }
  return workflowTemplate;
}

export async function customizeTemplateIfNeededAsync(
  workflowTemplate: WorkflowStarter,
  projectDir: string,
  exp: ExpoConfig
): Promise<any> {
  switch (workflowTemplate.name) {
    case WorkflowStarterName.BUILD:
      Log.debug('Adding build jobs to template...');
      return await addBuildJobsToDevelopmentBuildTemplateAsync(projectDir, workflowTemplate);
    case WorkflowStarterName.UPDATE:
      if (!exp?.updates?.url) {
        throw new Error(
          'EAS Update is not configured for this project. Please run "eas update:configure" to configure it.'
        );
      }
      return workflowTemplate;
    default:
      return workflowTemplate;
  }
}
