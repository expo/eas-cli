import { Platform, SubmissionConfig } from '@expo/eas-build-job';
import { SubmitProfile } from '@expo/eas-json';
import { BuildStepEnv } from '@expo/steps';
import fs from 'fs-extra';
import { graphql } from 'gql.tada';
import path from 'node:path';
import { z } from 'zod';

import { readIpaInfoAsync } from '../readIpaInfo';
import { BuildInfo, ResolvedSubmitConfig } from './common';
import { CustomBuildContext } from '../../../customBuildContext';

const APPLE_APP_IDENTIFIER_QUERY = graphql(`
  query ResolveSubmitConfigAppleAppIdentifier(
    $accountName: String!
    $bundleIdentifier: String!
  ) {
    account {
      byName(accountName: $accountName) {
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
    $projectFullName: String!
    $appleAppIdentifierId: String!
  ) {
    app {
      byFullName(fullName: $projectFullName) {
        id
        iosAppCredentials(filter: { appleAppIdentifierId: $appleAppIdentifierId }) {
          id
          appStoreConnectApiKeyForSubmissions {
            id
          }
        }
      }
    }
  }
`);

const APP_STORE_CONNECT_API_KEY_QUERY = graphql(`
  query ResolveSubmitConfigAppStoreConnectApiKey($id: ID!) {
    appStoreConnectApiKey {
      byId(id: $id) {
        id
        issuerIdentifier
        keyIdentifier
        keyP8
      }
    }
  }
`);

export async function resolveIosSubmitConfigAsync({
  artifactPath,
  build,
  ctx,
  env,
  profile,
  workingDirectory,
}: {
  artifactPath?: string;
  build: BuildInfo;
  ctx: CustomBuildContext;
  env: BuildStepEnv;
  profile: SubmitProfile<Platform.IOS>;
  workingDirectory: string;
}): Promise<ResolvedSubmitConfig> {
  const bundleIdentifier =
    build.appIdentifier ??
    profile.bundleIdentifier ??
    (artifactPath ? (await readIpaInfoAsync(artifactPath)).bundleIdentifier : undefined);

  if (!profile.ascAppId) {
    throw new Error('Set ascAppId in the submit profile in eas.json.');
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
            build,
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
  build,
  bundleIdentifier,
  ctx,
  profile,
  workingDirectory,
}: {
  build: BuildInfo;
  bundleIdentifier?: string;
  ctx: CustomBuildContext;
  profile: SubmitProfile<Platform.IOS>;
  workingDirectory: string;
}): Promise<string> {
  if (profile.ascApiKeyPath && profile.ascApiKeyIssuerId && profile.ascApiKeyId) {
    return JSON.stringify({
      issuer_id: profile.ascApiKeyIssuerId,
      key: await fs.readFile(path.resolve(workingDirectory, profile.ascApiKeyPath), 'utf8'),
      key_id: profile.ascApiKeyId,
    });
  }

  if (profile.ascApiKeyPath || profile.ascApiKeyIssuerId || profile.ascApiKeyId) {
    throw new Error(
      'ascApiKeyPath, ascApiKeyIssuerId and ascApiKeyId must all be defined in eas.json.'
    );
  }

  if (!bundleIdentifier) {
    throw new Error('Could not resolve iOS bundleIdentifier from build metadata or artifact.');
  }

  const appleAppIdentifierResult = await ctx.graphqlClient
    .query(APPLE_APP_IDENTIFIER_QUERY, {
      accountName: build.projectOwnerAccountName,
      bundleIdentifier,
    })
    .toPromise();
  if (appleAppIdentifierResult.error) {
    throw appleAppIdentifierResult.error;
  }

  const appleAppIdentifierId =
    appleAppIdentifierResult.data?.account.byName.appleAppIdentifiers[0]?.id;
  if (!appleAppIdentifierId) {
    throw new Error(`Apple App Identifier is not configured for ${bundleIdentifier}.`);
  }

  const credentialsResult = await ctx.graphqlClient
    .query(IOS_APP_CREDENTIALS_QUERY, {
      appleAppIdentifierId,
      projectFullName: build.projectFullName,
    })
    .toPromise();
  if (credentialsResult.error) {
    throw credentialsResult.error;
  }

  const ascApiKeyId =
    credentialsResult.data?.app.byFullName.iosAppCredentials[0]?.appStoreConnectApiKeyForSubmissions
      ?.id;
  if (!ascApiKeyId) {
    throw new Error(
      `App Store Connect API Key for submissions is not configured for ${bundleIdentifier}.`
    );
  }

  const apiKeyResult = await ctx.graphqlClient
    .query(APP_STORE_CONNECT_API_KEY_QUERY, { id: ascApiKeyId })
    .toPromise();
  if (apiKeyResult.error) {
    throw apiKeyResult.error;
  }

  const apiKey = apiKeyResult.data?.appStoreConnectApiKey.byId;
  if (!apiKey) {
    throw new Error(`App Store Connect API Key ${ascApiKeyId} could not be resolved.`);
  }
  return JSON.stringify({
    issuer_id: apiKey.issuerIdentifier,
    key: apiKey.keyP8,
    key_id: apiKey.keyIdentifier,
  });
}

function validateAppSpecificPassword(password: string): string {
  if (!/^[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}$/.test(password)) {
    throw new Error(
      'EXPO_APPLE_APP_SPECIFIC_PASSWORD must be in the format xxxx-xxxx-xxxx-xxxx, where x is a lowercase letter.'
    );
  }
  return password;
}

function requireAppleIdUsername(appleIdUsername?: string): string {
  if (!appleIdUsername) {
    throw new Error(
      'Set appleId in the submit profile or EXPO_APPLE_ID when using EXPO_APPLE_APP_SPECIFIC_PASSWORD.'
    );
  }
  return appleIdUsername;
}
