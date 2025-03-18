import { Platform, Workflow } from '@expo/eas-build-job';

import { createFingerprintAsync } from './cli';
import { Fingerprint } from './types';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { AppPlatform } from '../graphql/generated';
import { FingerprintMutation } from '../graphql/mutations/FingerprintMutation';
import Log from '../log';
import { maybeUploadFingerprintAsync } from '../project/maybeUploadFingerprintAsync';
import { resolveWorkflowPerPlatformAsync } from '../project/workflow';
import { Client } from '../vcs/vcs';

export async function getFingerprintInfoFromLocalProjectForPlatformsAsync(
  graphqlClient: ExpoGraphqlClient,
  projectDir: string,
  projectId: string,
  vcsClient: Client,
  platforms: AppPlatform[]
): Promise<Fingerprint> {
  const workflows = await resolveWorkflowPerPlatformAsync(projectDir, vcsClient);
  const optionsFromWorkflow = getFingerprintOptionsFromWorkflow(platforms, workflows);

  const projectFingerprint = await createFingerprintAsync(projectDir, {
    ...optionsFromWorkflow,
    platforms: platforms.map(appPlatformToString),
    debug: true,
    env: undefined,
  });
  if (!projectFingerprint) {
    throw new Error('Project fingerprints can only be computed for projects with SDK 52 or higher');
  }

  const uploadedFingerprint = await maybeUploadFingerprintAsync({
    hash: projectFingerprint.hash,
    fingerprint: {
      fingerprintSources: projectFingerprint.sources,
      isDebugFingerprintSource: Log.isDebug,
    },
    graphqlClient,
  });
  await FingerprintMutation.createFingerprintAsync(graphqlClient, projectId, {
    hash: uploadedFingerprint.hash,
    source: uploadedFingerprint.fingerprintSource,
  });

  return projectFingerprint;
}
function getFingerprintOptionsFromWorkflow(
  platforms: AppPlatform[],
  workflowsByPlatform: Record<Platform, Workflow>
): { workflow?: Workflow; ignorePaths?: string[] } {
  if (platforms.length === 0) {
    throw new Error('Could not determine platform from fingerprint sources');
  }

  // Single platform case
  if (platforms.length === 1) {
    const platform = platforms[0];
    return { workflow: workflowsByPlatform[appPlatformToPlatform(platform)] };
  }

  // Multiple platforms case
  const workflows = platforms.map(platform => workflowsByPlatform[appPlatformToPlatform(platform)]);

  // If all workflows are the same, return the common workflow
  const [firstWorkflow, ...restWorkflows] = workflows;
  if (restWorkflows.every(workflow => workflow === firstWorkflow)) {
    return { workflow: firstWorkflow };
  }

  // Generate ignorePaths for mixed workflows
  const ignorePaths = platforms
    .filter(platform => workflowsByPlatform[appPlatformToPlatform(platform)] === Workflow.MANAGED)
    .map(platform => `${appPlatformToString(platform)}/**/*`);

  return { ignorePaths };
}

export function appPlatformToPlatform(platform: AppPlatform): Platform {
  switch (platform) {
    case AppPlatform.Android:
      return Platform.ANDROID;
    case AppPlatform.Ios:
      return Platform.IOS;
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

export function appPlatformToString(platform: AppPlatform): string {
  switch (platform) {
    case AppPlatform.Android:
      return 'android';
    case AppPlatform.Ios:
      return 'ios';
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

export function stringToAppPlatform(platform: string): AppPlatform {
  switch (platform) {
    case 'android':
      return AppPlatform.Android;
    case 'ios':
      return AppPlatform.Ios;
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}
