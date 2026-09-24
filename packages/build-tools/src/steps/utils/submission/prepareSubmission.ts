import { Platform, UserError } from '@expo/eas-build-job';
import { EasJsonAccessor, EasJsonUtils, SubmitProfile } from '@expo/eas-json';
import { MissingProfileError } from '@expo/eas-json/build/errors';
import { bunyan } from '@expo/logger';
import fs from 'fs-extra';
import path from 'node:path';
import { z } from 'zod';

import { AscKey, SubmissionCredentials } from './credentials';

export type PreparedSubmission = {
  asc_app_identifier?: string;
  json_key_path?: string;
  apple_id_username?: string;
  apple_app_specific_password_path?: string;
  google_service_account_key_path?: string;
  groups?: string;
  track?: string;
  release_status?: string;
  rollout?: string;
  changes_not_sent_for_review?: string;
  is_verbose_fastlane_enabled: string;
};

export async function prepareSubmissionAsync({
  platform,
  buildId,
  profileName,
  applicationIdentifier,
  workingDirectory,
  credentialsDirectory,
  credentials,
  env,
  groups,
  ensureTestFlightSetupAsync,
  logger,
}: {
  platform: Platform;
  buildId: string;
  profileName?: string;
  applicationIdentifier: string;
  workingDirectory: string;
  credentialsDirectory: string;
  credentials: Pick<
    SubmissionCredentials,
    'validateBuildAsync' | 'getAscKeyAsync' | 'getGoogleKeyAsync'
  >;
  env: NodeJS.ProcessEnv;
  groups?: string[];
  ensureTestFlightSetupAsync: (key: AscKey, appId: string) => Promise<void>;
  logger: bunyan;
}): Promise<PreparedSubmission> {
  const buildProfile = await credentials.validateBuildAsync(buildId, platform);
  const accessor = EasJsonAccessor.fromProjectPath(workingDirectory);
  const selectedProfile = profileName ?? buildProfile ?? undefined;
  async function readProfileAsync<T extends Platform>(target: T): Promise<SubmitProfile<T>> {
    try {
      return await EasJsonUtils.getSubmitProfileAsync(accessor, target, selectedProfile, env);
    } catch (error) {
      if (profileName === undefined && error instanceof MissingProfileError) {
        return await EasJsonUtils.getSubmitProfileAsync(accessor, target, undefined, env);
      }
      throw error;
    }
  }
  await fs.ensureDir(credentialsDirectory, { mode: 0o700 });
  const writeSecretAsync = async (name: string, content: string): Promise<string> => {
    const filePath = path.join(credentialsDirectory, name);
    await fs.writeFile(filePath, content, { mode: 0o600, flag: 'wx' });
    return filePath;
  };
  const outputs: PreparedSubmission = { is_verbose_fastlane_enabled: 'false' };
  if (platform === Platform.IOS) {
    const profile = await readProfileAsync(Platform.IOS);
    if (!profile.ascAppId) {
      throw new UserError(
        'EAS_SUBMISSION_MISSING_ASC_APP_ID',
        'Set ascAppId in the submit profile in eas.json, then retry the job.'
      );
    }
    outputs.asc_app_identifier = profile.ascAppId;
    outputs.groups = (groups?.length ? groups : (profile.groups ?? [])).join(',');
    const identifier = profile.bundleIdentifier ?? applicationIdentifier;
    const password = env.EXPO_APPLE_APP_SPECIFIC_PASSWORD;
    if (password) {
      if (!/^[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}$/.test(password)) {
        throw new UserError(
          'EAS_SUBMISSION_INVALID_APPLE_PASSWORD',
          'EXPO_APPLE_APP_SPECIFIC_PASSWORD must have the form xxxx-xxxx-xxxx-xxxx, with lowercase letters. Update the secret and retry.'
        );
      }
      const username = profile.appleId || env.EXPO_APPLE_ID;
      if (!username) {
        throw new UserError(
          'EAS_SUBMISSION_MISSING_APPLE_ID',
          'Set appleId in the submit profile or EXPO_APPLE_ID in the job environment.'
        );
      }
      outputs.apple_id_username = username;
      outputs.apple_app_specific_password_path = await writeSecretAsync('apple-password', password);
    } else {
      let key: AscKey | null;
      if (profile.ascApiKeyPath || profile.ascApiKeyId || profile.ascApiKeyIssuerId) {
        if (!profile.ascApiKeyPath || !profile.ascApiKeyId) {
          throw new UserError(
            'EAS_SUBMISSION_INCOMPLETE_ASC_KEY',
            'Set both ascApiKeyPath and ascApiKeyId in the submit profile. For a team key, also set ascApiKeyIssuerId.'
          );
        }
        key = {
          key_id: profile.ascApiKeyId,
          ...(profile.ascApiKeyIssuerId ? { issuer_id: profile.ascApiKeyIssuerId } : {}),
          key: await fs.readFile(path.resolve(workingDirectory, profile.ascApiKeyPath), 'utf8'),
        };
      } else {
        key = await credentials.getAscKeyAsync(identifier);
      }
      if (!key) {
        throw new UserError(
          'EAS_SUBMISSION_MISSING_ASC_KEY',
          `No submission API key is configured for ${identifier}. Configure one with eas credentials, then retry the job.`
        );
      }
      outputs.json_key_path = await writeSecretAsync('asc-api-key.json', JSON.stringify(key));
    }

    // The CLI's best-effort group setup uses environment credentials or the stored
    // submission key, independently of the credentials selected for the upload.
    try {
      const hasEnvironmentKey =
        env.EXPO_ASC_API_KEY_PATH || env.EXPO_ASC_KEY_ID || env.EXPO_ASC_ISSUER_ID;
      const setupKey = hasEnvironmentKey
        ? env.EXPO_ASC_API_KEY_PATH && env.EXPO_ASC_KEY_ID && env.EXPO_APPLE_TEAM_ID
          ? {
              key_id: env.EXPO_ASC_KEY_ID,
              ...(env.EXPO_ASC_ISSUER_ID ? { issuer_id: env.EXPO_ASC_ISSUER_ID } : {}),
              key: await fs.readFile(
                path.resolve(workingDirectory, env.EXPO_ASC_API_KEY_PATH),
                'utf8'
              ),
            }
          : null
        : await credentials.getAscKeyAsync(identifier);
      if (setupKey) {
        await ensureTestFlightSetupAsync(setupKey, profile.ascAppId);
      }
    } catch {
      logger.warn(
        'Could not prepare TestFlight group credentials. Submission will continue. Check the groups in App Store Connect.'
      );
    }
  } else {
    const profile = await readProfileAsync(Platform.ANDROID);
    const identifier = profile.applicationId ?? applicationIdentifier;
    const keyJson = profile.serviceAccountKeyPath
      ? await fs.readFile(path.resolve(workingDirectory, profile.serviceAccountKeyPath), 'utf8')
      : await credentials.getGoogleKeyAsync(identifier);
    if (!keyJson) {
      throw new UserError(
        'EAS_SUBMISSION_MISSING_GOOGLE_KEY',
        `No service account key is configured for ${identifier}. Configure one with eas credentials or set serviceAccountKeyPath in eas.json.`
      );
    }
    try {
      z.object({ type: z.string(), private_key: z.string(), client_email: z.string() }).parse(
        JSON.parse(keyJson)
      );
    } catch {
      throw new UserError(
        'EAS_SUBMISSION_INVALID_GOOGLE_KEY',
        'The Google service account key is invalid. Provide a service account JSON key, not google-services.json.'
      );
    }
    outputs.google_service_account_key_path = await writeSecretAsync(
      'google-service-account.json',
      keyJson
    );
    outputs.track = profile.track;
    outputs.release_status = profile.releaseStatus;
    outputs.rollout = profile.rollout?.toString();
    outputs.changes_not_sent_for_review = String(profile.changesNotSentForReview ?? false);
  }
  return outputs;
}
