import { ExpoConfig } from '@expo/config';
import { Env, Platform, Workflow } from '@expo/eas-build-job';
import { BuildProfile } from '@expo/eas-json';

import {
  ensureApplicationIdIsDefinedForManagedProjectAsync,
  getApplicationIdAsync,
} from './android/applicationId';
import { resolveGradleBuildContextAsync } from './android/gradle';
import {
  ensureBundleIdentifierIsDefinedForManagedProjectAsync,
  getBundleIdentifierAsync,
} from './ios/bundleIdentifier';
import { resolveXcodeBuildContextAsync } from './ios/scheme';
import { findApplicationTarget, resolveTargetsAsync } from './ios/target';
import { resolveWorkflowAsync } from './workflow';
import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { Client } from '../vcs/vcs';

export async function getApplicationIdentifierAsync({
  graphqlClient,
  projectDir,
  projectId,
  exp,
  buildProfile,
  platform,
  vcsClient,
  nonInteractive,
  env,
}: {
  graphqlClient: ExpoGraphqlClient;
  projectDir: string;
  projectId: string;
  exp: ExpoConfig;
  buildProfile: BuildProfile;
  platform: Platform;
  vcsClient: Client;
  nonInteractive: boolean;
  env: Env;
}): Promise<string> {
  if (platform === Platform.ANDROID) {
    const profile = buildProfile as BuildProfile<Platform.ANDROID>;
    const workflow = await resolveWorkflowAsync(projectDir, Platform.ANDROID, vcsClient);

    if (workflow === Workflow.MANAGED) {
      return await ensureApplicationIdIsDefinedForManagedProjectAsync({
        graphqlClient,
        projectDir,
        projectId,
        exp,
        vcsClient,
        nonInteractive,
      });
    }

    const gradleContext = await resolveGradleBuildContextAsync(projectDir, profile, vcsClient);
    return await getApplicationIdAsync(projectDir, exp, vcsClient, gradleContext);
  } else {
    const workflow = await resolveWorkflowAsync(projectDir, Platform.IOS, vcsClient);
    const profile = buildProfile as BuildProfile<Platform.IOS>;
    if (workflow === Workflow.MANAGED) {
      return await ensureBundleIdentifierIsDefinedForManagedProjectAsync({
        graphqlClient,
        projectDir,
        projectId,
        exp,
        vcsClient,
        nonInteractive,
      });
    }

    const xcodeBuildContext = await resolveXcodeBuildContextAsync(
      { exp, projectDir, nonInteractive: false, vcsClient },
      profile
    );

    const targets = await resolveTargetsAsync({
      projectDir,
      exp,
      xcodeBuildContext,
      env,
      vcsClient,
    });
    const applicationTarget = findApplicationTarget(targets);
    return await getBundleIdentifierAsync(projectDir, exp, vcsClient, {
      targetName: applicationTarget.targetName,
      buildConfiguration: applicationTarget.buildConfiguration,
    });
  }
}
