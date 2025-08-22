import { ExpoConfig } from '@expo/config';
import { Platform } from '@expo/eas-build-job';
import { BuildProfile, EasJsonAccessor, EasJsonUtils } from '@expo/eas-json';

import { buildProfileNamesFromProjectAsync } from './validation';
import Log from '../../log';
import { promptAsync } from '../../prompts';
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
  name: 'Custom build',
  on: {
    push: {
      branches: ['main'],
    },
  },
  jobs: {
    custom_build: {
      name: 'Custom build',
      type: 'custom',
      runs_on: 'linux-medium',
      image: 'latest',
      steps: [
        {
          uses: 'eas/checkout',
        },
        {
          name: 'Hello World',
          id: 'hello-world',
          run: '# Custom script\necho "Hello, World"\n',
        },
      ],
    },
  },
};

const BUILD_TEMPLATE = {
  name: 'Run development builds',
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
    maestro_test: {
      needs: ['build_android_for_e2e'],
      type: 'maestro',
      params: {
        build_id: '${{ needs.build_android_for_e2e.outputs.build_id }}',
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
      '# This is a skeleton workflow, showing a custom job that executes',
      '# both a predefined workflow step, and a custom script defined by the developer.',
      '# See https://docs.expo.dev/eas/workflows/syntax/#jobsjob_idstepsstepuses for more information',
      '# on the different types of steps you can use.',
      '#',
      createdByEASCLI,
      '#',
    ],
  },
  {
    displayName: 'Create EAS builds',
    name: WorkflowStarterName.BUILD,
    defaultFileName: 'eas-builds.yml',
    template: BUILD_TEMPLATE,
    headerLines: [
      '# This workflow will run EAS builds for your app,',
      '# using the build profiles you have defined in eas.json.',
      '# See https://docs.expo.dev/eas/workflows/pre-packaged-jobs/#build ',
      '# for more information.',
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
export async function getBuildProfileAsync(
  projectDir: string,
  platform: Platform,
  profileName: string
): Promise<BuildProfile<Platform>> {
  const easJsonAccessor = EasJsonAccessor.fromProjectPath(projectDir);
  const buildProfile = await EasJsonUtils.getBuildProfileAsync(
    easJsonAccessor,
    platform,
    profileName
  );
  return buildProfile;
}
export async function addBuildJobsToTemplateAsync(
  projectDir: string,
  workflowTemplate: WorkflowStarter
): Promise<WorkflowStarter> {
  const buildProfiles = [...(await buildProfileNamesFromProjectAsync(projectDir))];
  if (buildProfiles.length === 0) {
    return workflowTemplate;
  }
  const androidBuildProfilesToAdd = (
    await promptAsync({
      type: 'multiselect',
      name: 'selectedProfiles',
      message: 'Select Android builds to add to workflow',
      choices: buildProfiles.map(profileName => ({
        title: profileName,
        value: profileName,
      })),
    })
  ).selectedProfiles;
  const iOSBuildProfilesToAdd = (
    await promptAsync({
      type: 'multiselect',
      name: 'selectedProfiles',
      message: 'Select iOS builds to add to workflow',
      choices: buildProfiles.map(profileName => ({
        title: profileName,
        value: profileName,
      })),
    })
  ).selectedProfiles;
  for (const profileName of androidBuildProfilesToAdd) {
    const platform = Platform.ANDROID;
    workflowTemplate.template.jobs[`${profileName}-${platform}`] = {
      name: `Build ${profileName} for ${platform}`,
      type: 'build',
      params: {
        profile: profileName,
        platform,
      },
    };
  }
  for (const profileName of iOSBuildProfilesToAdd) {
    const platform = Platform.IOS;
    workflowTemplate.template.jobs[`${profileName}-${platform}`] = {
      name: `Build ${profileName} for ${platform}`,
      type: 'build',
      params: {
        profile: profileName,
        platform,
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
      return await addBuildJobsToTemplateAsync(projectDir, workflowTemplate);
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
