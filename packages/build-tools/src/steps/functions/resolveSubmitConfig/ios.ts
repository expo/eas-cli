import { Platform, SubmissionConfig, UserError } from '@expo/eas-build-job';
import { SubmitProfile } from '@expo/eas-json';
import { BuildStepEnv } from '@expo/steps';
import fs from 'fs-extra';
import { graphql } from 'gql.tada';
import path from 'node:path';
import { z } from 'zod';

import { readIpaInfoAsync } from '../readIpaInfo';
import { ResolvedSubmitConfig } from './common';
import { CustomBuildContext } from '../../../customBuildContext';

const APPLE_APP_IDENTIFIER_QUERY = graphql(`
  query ResolveSubmitConfigAppleAppIdentifier(
    $accountId: String!
    $bundleIdentifier: String!
  ) {
    account {
      byId(accountId: $accountId) {
        id
        appleAppIdentifiers(bundleIdentifier: $bundleIdentifier) {
          id
          bundleIdentifier
        }
      }
    }
  }
`);

const IOS_APP_CREDENTIALS_QUERY = graphql(`
  query ResolveSubmitConfigIosAppCredentials(
    $appId: String!
    $appleAppIdentifierId: String!
  ) {
    app {
      byId(appId: $appId) {
        id
        iosAppCredentials(filter: { appleAppIdentifierId: $appleAppIdentifierId }) {
          id
          appStoreConnectApiKeyForSubmissions {
            id
            issuerIdentifier
            keyIdentifier
            keyP8
          }
        }
      }
    }
  }
`);

export async function resolveIosSubmitConfigAsync({
  appId,
  artifactPath,
  buildAppIdentifier,
  ctx,
  env,
  profile,
  projectOwnerAccountId,
  workingDirectory,
}: {
  appId: string;
  artifactPath: string;
  buildAppIdentifier?: string | null;
  ctx: CustomBuildContext;
  env: BuildStepEnv;
  profile: SubmitProfile<Platform.IOS>;
  projectOwnerAccountId: string;
  workingDirectory: string;
}): Promise<ResolvedSubmitConfig> {
  const bundleIdentifier =
    buildAppIdentifier ??
    profile.bundleIdentifier ??
    (await readIpaInfoAsync(artifactPath)).bundleIdentifier;

  if (!profile.ascAppId) {
    throw new UserError(
      'EAS_RESOLVE_SUBMIT_CONFIG_IOS_ASC_APP_ID_NOT_CONFIGURED',
      'Set ascAppId in the submit profile in eas.json.'
    );
  }

  const appSpecificPassword = env.EXPO_APPLE_APP_SPECIFIC_PASSWORD;
  const configInput: z.input<typeof SubmissionConfig.Ios.SchemaZ> = {
    ascAppIdentifier: profile.ascAppId,
    groups: profile.groups,
    ...(appSpecificPassword
      ? {
          appleAppSpecificPassword: validateAppSpecificPassword(appSpecificPassword),
          appleIdUsername: requireAppleIdUsername(profile.appleId ?? env.EXPO_APPLE_ID),
        }
      : {
          ascApiJsonKey: await getAscApiJsonKeyAsync({
            accountId: projectOwnerAccountId,
            appId,
            bundleIdentifier,
            ctx,
            profile,
            workingDirectory,
          }),
        }),
  };

  return {
    appIdentifier: bundleIdentifier,
    config: SubmissionConfig.Ios.SchemaZ.parse(configInput),
    platform: Platform.IOS,
  };
}

async function getAscApiJsonKeyAsync({
  accountId,
  appId,
  bundleIdentifier,
  ctx,
  profile,
  workingDirectory,
}: {
  accountId: string;
  appId: string;
  bundleIdentifier?: string;
  ctx: CustomBuildContext;
  profile: SubmitProfile<Platform.IOS>;
  workingDirectory: string;
}): Promise<string> {
  // Prefer explicit local ASC API key fields from eas.json when all are present.
  if (profile.ascApiKeyPath && profile.ascApiKeyIssuerId && profile.ascApiKeyId) {
    return JSON.stringify({
      issuer_id: profile.ascApiKeyIssuerId,
      key: await fs.readFile(path.resolve(workingDirectory, profile.ascApiKeyPath), 'utf8'),
      key_id: profile.ascApiKeyId,
    });
  }

  if (profile.ascApiKeyPath || profile.ascApiKeyIssuerId || profile.ascApiKeyId) {
    throw new UserError(
      'EAS_RESOLVE_SUBMIT_CONFIG_IOS_ASC_API_KEY_INCOMPLETE',
      'ascApiKeyPath, ascApiKeyIssuerId and ascApiKeyId must all be defined in eas.json.'
    );
  }

  if (!bundleIdentifier) {
    throw new UserError(
      'EAS_RESOLVE_SUBMIT_CONFIG_IOS_BUNDLE_IDENTIFIER_NOT_FOUND',
      'Could not resolve iOS bundleIdentifier from build metadata or artifact. Set bundleIdentifier in the iOS submit profile, or pass an IPA artifact with a readable bundle identifier.'
    );
  }

  // Server credentials are keyed by the Apple App Identifier, so first map the bundle id to it.
  const appleAppIdentifierResult = await ctx.graphqlClient
    .query(APPLE_APP_IDENTIFIER_QUERY, {
      accountId,
      bundleIdentifier,
    })
    .toPromise();
  if (appleAppIdentifierResult.error) {
    throw appleAppIdentifierResult.error;
  }

  const appleAppIdentifierId =
    appleAppIdentifierResult.data?.account.byId.appleAppIdentifiers[0]?.id;
  if (!appleAppIdentifierId) {
    throw new UserError(
      'EAS_RESOLVE_SUBMIT_CONFIG_IOS_APP_IDENTIFIER_NOT_CONFIGURED',
      `Apple App Identifier is not configured for ${bundleIdentifier}. Configure the bundle identifier in EAS credentials for this account.`
    );
  }

  // The app credentials record points at the ASC API key selected for submissions.
  const credentialsResult = await ctx.graphqlClient
    .query(IOS_APP_CREDENTIALS_QUERY, {
      appId,
      appleAppIdentifierId,
    })
    .toPromise();
  if (credentialsResult.error) {
    throw credentialsResult.error;
  }

  const ascApiKey =
    credentialsResult.data?.app.byId.iosAppCredentials[0]?.appStoreConnectApiKeyForSubmissions;
  if (!ascApiKey) {
    throw new UserError(
      'EAS_RESOLVE_SUBMIT_CONFIG_IOS_ASC_API_KEY_NOT_CONFIGURED',
      `App Store Connect API Key for submissions is not configured for ${bundleIdentifier}. Configure an App Store Connect API Key for submissions in EAS credentials, or set ascApiKeyPath, ascApiKeyIssuerId, and ascApiKeyId in the iOS submit profile.`
    );
  }

  return JSON.stringify({
    issuer_id: ascApiKey.issuerIdentifier,
    key: ascApiKey.keyP8,
    key_id: ascApiKey.keyIdentifier,
  });
}

function validateAppSpecificPassword(password: string): string {
  if (!/^[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}$/.test(password)) {
    throw new UserError(
      'EAS_RESOLVE_SUBMIT_CONFIG_IOS_APP_SPECIFIC_PASSWORD_INVALID',
      'EXPO_APPLE_APP_SPECIFIC_PASSWORD must be in the format xxxx-xxxx-xxxx-xxxx, where x is a lowercase letter.'
    );
  }
  return password;
}

function requireAppleIdUsername(appleIdUsername?: string): string {
  if (!appleIdUsername) {
    throw new UserError(
      'EAS_RESOLVE_SUBMIT_CONFIG_IOS_APPLE_ID_NOT_CONFIGURED',
      'Set appleId in the submit profile or EXPO_APPLE_ID when using EXPO_APPLE_APP_SPECIFIC_PASSWORD.'
    );
  }
  return appleIdUsername;
}
