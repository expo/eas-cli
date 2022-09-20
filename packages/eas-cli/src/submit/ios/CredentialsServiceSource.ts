import { Platform } from '@expo/eas-build-job';
import nullthrows from 'nullthrows';

import { SetUpSubmissionCredentials } from '../../credentials/ios/actions/SetUpSubmissionCredentials';
import Log from '../../log';
import {
  INVALID_BUNDLE_IDENTIFIER_MESSAGE,
  isBundleIdentifierValid,
} from '../../project/ios/bundleIdentifier';
import { promptAsync } from '../../prompts';
import { SubmissionContext } from '../context';
import {
  AppSpecificPasswordCredentials,
  getAppleIdUsernameAsync,
} from './AppSpecificPasswordSource';
import { AscApiKeyResult } from './AscApiKeySource';

/**
 * The Credentials Service will either return an ASC API Key or an App Specific Password
 * When we no longer support the App Specific Password user prompt, refactor this into the AscApiKeySource
 */
export const CREDENTIALS_SERVICE_SOURCE = 'CREDENTIALS_SERVICE_SOURCE' as const;
export interface CredentialsServiceSource {
  sourceType: typeof CREDENTIALS_SERVICE_SOURCE;
  bundleIdentifier?: string;
}

async function promptForBundleIdentifierAsync(): Promise<string> {
  const { bundleIdentifier } = await promptAsync({
    name: 'bundleIdentifier',
    message: 'Bundle identifier:',
    type: 'text',
    validate: value => (isBundleIdentifierValid(value) ? true : INVALID_BUNDLE_IDENTIFIER_MESSAGE),
  });
  return bundleIdentifier;
}

export async function getFromCredentialsServiceAsync(
  ctx: SubmissionContext<Platform.IOS>,
  source: CredentialsServiceSource
): Promise<
  { appSpecificPassword: AppSpecificPasswordCredentials } | { ascApiKeyResult: AscApiKeyResult }
> {
  const bundleIdentifier = source.bundleIdentifier ?? (await promptForBundleIdentifierAsync());
  Log.log(`Looking up credentials configuration for ${bundleIdentifier}...`);

  const appLookupParams = {
    account: nullthrows(
      ctx.user.accounts.find(a => a.name === ctx.accountName),
      `You do not have access to account: ${ctx.accountName}`
    ),
    projectName: ctx.projectName,
    bundleIdentifier,
  };
  const setupSubmissionCredentialsAction = new SetUpSubmissionCredentials(appLookupParams);
  const ascOrAsp = await setupSubmissionCredentialsAction.runAsync(ctx.credentialsCtx);
  const isAppSpecificPassword = typeof ascOrAsp === 'string';
  if (isAppSpecificPassword) {
    return {
      appSpecificPassword: {
        password: ascOrAsp,
        appleIdUsername: await getAppleIdUsernameAsync(ctx),
      },
    };
  } else {
    const ascKeyForSubmissions = nullthrows(
      ascOrAsp.appStoreConnectApiKeyForSubmissions,
      `An EAS Submit ASC API Key could not be found for ${ascOrAsp.appleAppIdentifier.bundleIdentifier}`
    );
    const { id, keyIdentifier, name } = ascKeyForSubmissions;
    return {
      ascApiKeyResult: {
        result: {
          ascApiKeyId: id,
        },
        summary: {
          source: 'EAS servers',
          keyId: keyIdentifier,
          name: name ?? undefined,
        },
      },
    };
  }
}
