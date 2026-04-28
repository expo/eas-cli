import { Platform, SubmissionConfig, SystemError, UserError } from '@expo/eas-build-job';
import { SubmitProfile } from '@expo/eas-json';
import { bunyan } from '@expo/logger';
import { asyncResult } from '@expo/results';
import spawn from '@expo/turtle-spawn';
import { BuildStepEnv } from '@expo/steps';
import fs from 'fs-extra';
import { graphql } from 'gql.tada';
import path from 'node:path';
import { z } from 'zod';

import { BuildInfo, ResolvedSubmitConfig } from './common';
import { CustomBuildContext } from '../../../customBuildContext';

const ANDROID_APP_CREDENTIALS_QUERY = graphql(`
  query ResolveSubmitConfigAndroidAppCredentials(
    $projectFullName: String!
    $applicationIdentifier: String
  ) {
    app {
      byFullName(fullName: $projectFullName) {
        id
        androidAppCredentials(filter: { applicationIdentifier: $applicationIdentifier }) {
          id
          googleServiceAccountKeyForSubmissions {
            id
            keyJson
          }
        }
      }
    }
  }
`);

export async function resolveAndroidSubmitConfigAsync({
  artifactPath,
  build,
  ctx,
  env,
  logger,
  profile,
  workingDirectory,
}: {
  artifactPath: string;
  build: BuildInfo;
  ctx: CustomBuildContext;
  env: BuildStepEnv;
  logger: bunyan;
  profile: SubmitProfile<Platform.ANDROID>;
  workingDirectory: string;
}): Promise<ResolvedSubmitConfig> {
  const applicationId =
    build.appIdentifier ??
    profile.applicationId ??
    (await readAndroidApplicationIdAsync(artifactPath, env, logger));

  const googleServiceAccountKeyJson = profile.serviceAccountKeyPath
    ? await fs.readFile(path.resolve(workingDirectory, profile.serviceAccountKeyPath), 'utf8')
    : await getGoogleServiceAccountKeyJsonAsync({
        applicationId,
        build,
        ctx,
      });

  const releaseStatus = profile.releaseStatus as unknown as SubmissionConfig.Android.ReleaseStatus;
  const baseConfigInput = {
    changesNotSentForReview: profile.changesNotSentForReview,
    googleServiceAccountKeyJson,
    track: profile.track,
  };
  const configInput: z.input<typeof SubmissionConfig.Android.SchemaZ> =
    releaseStatus === SubmissionConfig.Android.ReleaseStatus.IN_PROGRESS
      ? {
          ...baseConfigInput,
          releaseStatus,
          rollout: profile.rollout,
        }
      : {
          ...baseConfigInput,
          releaseStatus,
        };

  return {
    appIdentifier: applicationId,
    config: SubmissionConfig.Android.SchemaZ.parse(configInput),
    platform: Platform.ANDROID,
  };
}

async function getGoogleServiceAccountKeyJsonAsync({
  applicationId,
  build,
  ctx,
}: {
  applicationId?: string;
  build: BuildInfo;
  ctx: CustomBuildContext;
}): Promise<string> {
  if (!applicationId) {
    throw new UserError(
      'EAS_RESOLVE_SUBMIT_CONFIG_ANDROID_APPLICATION_ID_NOT_FOUND',
      'Could not resolve Android applicationId from build metadata or artifact.'
    );
  }

  const credentialsResult = await ctx.graphqlClient
    .query(ANDROID_APP_CREDENTIALS_QUERY, {
      applicationIdentifier: applicationId,
      projectFullName: build.projectFullName,
    })
    .toPromise();
  if (credentialsResult.error) {
    throw credentialsResult.error;
  }

  const key =
    credentialsResult.data?.app.byFullName.androidAppCredentials[0]
      ?.googleServiceAccountKeyForSubmissions;
  if (!key) {
    throw new UserError(
      'EAS_RESOLVE_SUBMIT_CONFIG_ANDROID_SERVICE_ACCOUNT_KEY_NOT_CONFIGURED',
      `Google Service Account Key for submissions is not configured for ${applicationId}.`
    );
  }

  if (!key.keyJson) {
    throw new SystemError(`Google Service Account Key ${key.id} could not be resolved.`);
  }
  return key.keyJson;
}

async function readAndroidApplicationIdAsync(
  artifactPath: string,
  env: BuildStepEnv,
  logger: bunyan
): Promise<string | undefined> {
  if (artifactPath.endsWith('.apk')) {
    return await readAndroidApplicationIdFromApkAsync(artifactPath, env, logger);
  } else if (artifactPath.endsWith('.aab')) {
    return await readAndroidApplicationIdFromAabAsync(artifactPath, env, logger);
  }
  return undefined;
}

async function readAndroidApplicationIdFromApkAsync(
  apkPath: string,
  env: BuildStepEnv,
  logger: bunyan
): Promise<string | undefined> {
  const aapt2Result = await asyncResult(spawn('aapt2', ['dump', 'packagename', apkPath], { env }));
  if (aapt2Result.ok) {
    return aapt2Result.value.stdout.trim();
  }
  logger.warn('Failed to read APK package name with aapt2, trying aapt.');

  const aaptResult = await asyncResult(spawn('aapt', ['dump', 'badging', apkPath], { env }));
  if (!aaptResult.ok) {
    logger.warn('Failed to read APK package name with aapt.');
    return undefined;
  }
  return aaptResult.value.stdout.match(/package: name='([^']+)'/)?.[1];
}

async function readAndroidApplicationIdFromAabAsync(
  aabPath: string,
  env: BuildStepEnv,
  logger: bunyan
): Promise<string | undefined> {
  const result = await asyncResult(
    spawn('bundletool', ['dump', 'manifest', `--bundle=${aabPath}`, '--xpath=/manifest/@package'], {
      env,
    })
  );
  if (!result.ok) {
    logger.warn('Failed to read AAB package name with bundletool.');
    return undefined;
  }
  return result.value.stdout
    .trim()
    .replace(/^package="/, '')
    .replace(/"$/, '');
}
