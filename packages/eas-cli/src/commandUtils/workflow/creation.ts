import { ExpoConfig } from '@expo/config';
import { Platform } from '@expo/eas-build-job';

import {
  addAndroidDevelopmentBuildProfileToEasJsonAsync,
  addIosDevelopmentBuildProfileToEasJsonAsync,
  buildProfileNamesFromProjectAsync,
  buildProfilesFromProjectAsync,
  getBuildProfileAsync,
  isBuildProfileForDevelopment,
  isIosBuildProfileForSimulator,
} from './buildProfileUtils';
import Log from '../../log';
import { confirmAsync, promptAsync } from '../../prompts';
import { easCliVersion } from '../../utils/easCli';

export enum WorkflowStarterName {
  BUILD = 'build',
  UPDATE = 'update',
  MAESTRO = 'maestro',
  CUSTOM = 'custom',
}

export type WorkflowStarter = {
  name: WorkflowStarterName;
  displayName: string;
  defaultFileName: string;
  template: any;
  headerLines: string[];
};

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

const BUILD_TEMPLATE = {
  name: 'Create development builds',
  on: {
    push: {
      branches: ['main'],
    },
  },
  jobs: {},
};

const PUBLISH_UPDATE_TEMPLATE = {
  name: 'Publish updates',
  on: {
    push: {
      branches: ['main'],
    },
    pull_request: {
      branches: ['main'],
    },
  },
  jobs: {},
};

const MAESTRO_TEST_TEMPLATE = {
  name: 'Maestro E2E test for Android',
  on: {
    pull_request: {
      branches: ['main'],
    },
  },
  jobs: {
    build_android_for_e2e: {
      type: 'build',
      params: {
        platform: 'android',
        profile: '<selected_build_profile>', // will be replaced by the user's selection
      },
    },
    maestro_test_android: {
      needs: ['build_android_for_e2e'],
      type: 'maestro',
      params: {
        build_id: '${{ needs.build_android_for_e2e.outputs.build_id }}',
        flow_path: ['.maestro/home.yml'],
      },
    },
    build_ios_for_e2e: {
      type: 'build',
      params: {
        platform: 'ios',
        profile: '<selected_build_profile>', // will be replaced by the user's selection
      },
    },
    maestro_test_ios: {
      needs: ['build_ios_for_e2e'],
      type: 'maestro',
      params: {
        build_id: '${{ needs.build_ios_for_e2e.outputs.build_id }}',
        flow_path: ['.maestro/home.yml'],
      },
    },
  },
};

const createdByEASCLI = `# Created by EAS CLI v${easCliVersion}`;

export const workflowStarters: WorkflowStarter[] = [
  {
    displayName: 'Custom',
    name: WorkflowStarterName.CUSTOM,
    defaultFileName: 'custom.yml',
    template: CUSTOM_TEMPLATE,
    headerLines: [
      '# Custom job',
      '#',
      '# This workflow shows how to write custom jobs.',
      '# It contains a predefined workflow step and a shell command to print "Hello, World!".',
      '#',
      '# Key features:',
      '# - Triggers on pushes to the main branch (Requires linked GitHub account: https://expo.dev/accounts/[account]/settings/github)',
      '# - Can be triggered manually with eas workflow:run custom.yml',
      '# - Runs eas/checkout then a custom `echo` command',
      '#',
      '# For detailed documentation on workflow syntax and available step types, visit:',
      '# https://docs.expo.dev/eas/workflows/syntax/#jobsjob_idstepsstepuses',
      '#',
      createdByEASCLI,
      '#',
    ],
  },
  {
    displayName: 'Create development builds',
    name: WorkflowStarterName.BUILD,
    defaultFileName: 'create-development-builds.yml',
    template: BUILD_TEMPLATE,
    headerLines: [
      '# Create development builds',
      '#',
      '# This workflow shows how to create development builds.',
      '#',
      '# Key features:',
      '# - Can be triggered manually with eas workflow:run create-development-builds.yml',
      '# - Runs the pre-packaged build job to create Android and iOS development builds for Android emulators, Android and iOS devices, and iOS simulators',
      '#',
      '# For a detailed guide on using this workflow, visit:',
      '# https://docs.expo.dev/develop/development-builds/introduction/',
      '#',
      createdByEASCLI,
      '#',
    ],
  },
  {
    displayName: 'Publish updates',
    name: WorkflowStarterName.UPDATE,
    defaultFileName: 'publish-updates.yml',
    template: PUBLISH_UPDATE_TEMPLATE,
    headerLines: [
      '# This workflow will publish updates for your app,',
      '# using the update channels you have defined in eas.json.',
      '# See https://docs.expo.dev/eas/workflows/pre-packaged-jobs/#update ',
      '# for more information.',
      '#',
      createdByEASCLI,
      '#',
    ],
  },
  {
    displayName: 'Maestro E2E test',
    name: WorkflowStarterName.MAESTRO,
    defaultFileName: 'maestro-test.yml',
    template: MAESTRO_TEST_TEMPLATE,
    headerLines: [
      '# This workflow will run Maestro E2E tests for your app.',
      '# See https://docs.expo.dev/eas/workflows/examples/e2e-tests/',
      '# for a full-featured example of how to set up E2E tests.',
      '#',
      createdByEASCLI,
      '#',
    ],
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

async function modifyMaestroTestTemplateAsync(
  workflowTemplate: WorkflowStarter,
  projectDir: string
): Promise<WorkflowStarter> {
  const buildProfiles = [...(await buildProfileNamesFromProjectAsync(projectDir))];
  if (buildProfiles.length === 0) {
    return workflowTemplate;
  }
  const { selectedProfile } = await promptAsync({
    type: 'select',
    name: 'selectedProfile',
    message: 'Select a build profile to use for the Maestro E2E test',
    choices: buildProfiles.map(profileName => ({
      title: profileName,
      value: profileName,
    })),
  });
  const newTemplate = { ...workflowTemplate.template };
  newTemplate.jobs.build_android_for_e2e.params.profile = selectedProfile;
  newTemplate.jobs.build_ios_for_e2e.params.profile = selectedProfile;
  return { ...workflowTemplate, template: newTemplate };
}

async function addUpdateJobsToTemplateAsync(
  workflowTemplate: WorkflowStarter,
  projectDir: string
): Promise<WorkflowStarter> {
  const buildProfileNames = [...(await buildProfileNamesFromProjectAsync(projectDir))];
  if (buildProfileNames.length === 0) {
    return workflowTemplate;
  }
  const channels = new Set<string>();
  for (const profileName of buildProfileNames) {
    const buildProfile = await getBuildProfileAsync(projectDir, Platform.ANDROID, profileName);
    if (buildProfile.channel) {
      channels.add(buildProfile.channel);
    }
  }
  for (const profileName of buildProfileNames) {
    const buildProfile = await getBuildProfileAsync(projectDir, Platform.IOS, profileName);
    if (buildProfile.channel) {
      channels.add(buildProfile.channel);
    }
  }
  const channelsToUpdate = (
    await promptAsync({
      type: 'multiselect',
      name: 'selectedChannels',
      message: 'Select update channels to add to workflow',
      choices: [...channels].map(profileName => ({
        title: profileName,
        value: profileName,
      })),
    })
  ).selectedChannels;
  for (const channel of channelsToUpdate) {
    workflowTemplate.template.jobs[`publish_update_for_${channel}`] = {
      name: `Publish update for ${channel}`,
      type: 'update',
      params: {
        channel,
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
    case WorkflowStarterName.MAESTRO:
      Log.debug('Modifying Maestro test template...');
      return await modifyMaestroTestTemplateAsync(workflowTemplate, projectDir);
    case WorkflowStarterName.UPDATE:
      if (!exp?.updates?.url) {
        throw new Error(
          'EAS Update is not configured for this project. Please run "eas update:configure" to configure it.'
        );
      }
      Log.debug('Modifying update template...');
      return await addUpdateJobsToTemplateAsync(workflowTemplate, projectDir);
    default:
      return workflowTemplate;
  }
}
