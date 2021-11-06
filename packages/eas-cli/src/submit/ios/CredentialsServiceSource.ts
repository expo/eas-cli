import { Platform } from '@expo/eas-build-job';
import nullthrows from 'nullthrows';

import { SetUpSubmissionCredentials } from '../../credentials/ios/actions/SetUpSubmissionCredentials';
import Log from '../../log';
import { getBundleIdentifierAsync } from '../../project/ios/bundleIdentifier';
import { findAccountByName } from '../../user/Account';
import { SubmissionContext } from '../context';
import { AppSpecificPassword, getAppleIdUsernameAsync } from './AppSpecificPasswordSource';
import { AscApiKeyResult } from './AscApiKeySource';

/**
 * The Credentials Service will either return an ASC Api Key or an App Specific Password
 * When we no longer support the App Specific Password user prompt, refactor this into the AscApiKeySource
 */
export const CREDENTIALS_SERVICE_SOURCE = 'CREDENTIALS_SERVICE_SOURCE';
export type CredentialsServiceSource = typeof CREDENTIALS_SERVICE_SOURCE;

export async function getFromCredentialsServiceAsync(
  ctx: SubmissionContext<Platform.IOS>
): Promise<{ appSpecificPassword: AppSpecificPassword } | { ascApiKeyResult: AscApiKeyResult }> {
  const bundleIdentifier = await getBundleIdentifierAsync(ctx.projectDir, ctx.exp);
  Log.log(`Looking up credentials configuration for ${bundleIdentifier}...`);

  const appLookupParams = {
    account: nullthrows(
      findAccountByName(ctx.user.accounts, ctx.accountName),
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
      `An EAS Submit ASC Api Key could not be found for ${ascOrAsp.appleAppIdentifier.bundleIdentifier}`
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
