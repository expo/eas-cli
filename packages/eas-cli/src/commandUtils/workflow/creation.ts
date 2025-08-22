import { Platform } from '@expo/eas-build-job';
import { BuildProfile, EasJsonAccessor, EasJsonUtils } from '@expo/eas-json';

import { buildProfileNamesFromProjectAsync } from './validation';
import Log from '../../log';
import { promptAsync } from '../../prompts';

export enum WorkflowTemplateName {
  BUILD = 'build',
  UPDATE = 'update',
  DEPLOY = 'deploy',
  MAESTRO = 'maestro',
  CUSTOM = 'custom',
}

export type WorkflowTemplate = {
  name: WorkflowTemplateName;
  displayName: string;
  defaultFileName: string;
  template: any;
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

const DEVELOPMENT_BUILD_TEMPLATE = {
  name: 'Run development builds',
  on: {
    push: {
      branches: ['main'],
    },
  },
  jobs: {},
};

const PUBLISH_PREVIEW_UPDATE_TEMPLATE = {
  name: 'Publish preview updates',
  on: {
    push: {
      branches: ['main'],
    },
  },
  jobs: {
    publish_preview_update: {
      name: 'Publish preview update',
      type: 'update',
      params: {
        channel: 'preview',
      },
    },
  },
};

const DEPLOY_TO_PRODUCTION_TEMPLATE = {
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

export const workflowTemplates: WorkflowTemplate[] = [
  {
    displayName: 'Custom',
    name: WorkflowTemplateName.CUSTOM,
    defaultFileName: 'custom.yml',
    template: CUSTOM_TEMPLATE,
  },
  {
    displayName: 'Create EAS builds',
    name: WorkflowTemplateName.BUILD,
    defaultFileName: 'eas-builds.yml',
    template: DEVELOPMENT_BUILD_TEMPLATE,
  },
  {
    displayName: 'Publish preview updates',
    name: WorkflowTemplateName.UPDATE,
    defaultFileName: 'publish-preview-updates.yml',
    template: PUBLISH_PREVIEW_UPDATE_TEMPLATE,
  },
  {
    displayName: 'Deploy to production',
    name: WorkflowTemplateName.DEPLOY,
    defaultFileName: 'deploy-to-production.yml',
    template: DEPLOY_TO_PRODUCTION_TEMPLATE,
  },
  {
    displayName: 'Maestro E2E test',
    name: WorkflowTemplateName.MAESTRO,
    defaultFileName: 'maestro-test.yml',
    template: MAESTRO_TEST_TEMPLATE,
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
  workflowTemplate: WorkflowTemplate
): Promise<WorkflowTemplate> {
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
  workflowTemplate: WorkflowTemplate,
  projectDir: string
): Promise<WorkflowTemplate> {
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

export async function customizeTemplateIfNeededAsync(
  workflowTemplate: WorkflowTemplate,
  projectDir: string
): Promise<any> {
  switch (workflowTemplate.name) {
    case WorkflowTemplateName.BUILD:
      Log.debug('Adding build jobs to template...');
      return await addBuildJobsToTemplateAsync(projectDir, workflowTemplate);
    case WorkflowTemplateName.MAESTRO:
      Log.debug('Modifying Maestro test template...');
      return await modifyMaestroTestTemplateAsync(workflowTemplate, projectDir);
    default:
      return workflowTemplate;
  }
}
