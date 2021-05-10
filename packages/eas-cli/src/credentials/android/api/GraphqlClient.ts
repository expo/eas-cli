import {
  AndroidKeystoreFragment,
  CommonAndroidAppCredentialsFragment,
} from '../../../graphql/generated';
import { Account } from '../../../user/Account';
import { KeystoreWithType } from '../credentials';
import { AndroidKeystoreMutation } from './graphql/mutations/AndroidKeystoreMutation';
import { AndroidAppCredentialsQuery } from './graphql/queries/AndroidAppCredentialsQuery';

export interface AppLookupParams {
  account: Account;
  projectName: string;
  androidApplicationIdentifier: string; // 'android.package' field in app.json
}

export async function getAndroidAppCredentialsWithCommonFieldsAsync(
  appLookupParams: AppLookupParams
): Promise<CommonAndroidAppCredentialsFragment | null> {
  const { androidApplicationIdentifier } = appLookupParams;
  const projectFullName = formatProjectFullName(appLookupParams);
  return await AndroidAppCredentialsQuery.withCommonFieldsByApplicationIdentifierAsync(
    projectFullName,
    {
      androidApplicationIdentifier,
      legacyOnly: false,
    }
  );
}

/* There is at most one set of legacy android app credentials associated with an Expo App */
export async function getLegacyAndroidAppCredentialsWithCommonFieldsAsync(
  appLookupParams: AppLookupParams
): Promise<CommonAndroidAppCredentialsFragment | null> {
  const projectFullName = formatProjectFullName(appLookupParams);
  return await AndroidAppCredentialsQuery.withCommonFieldsByApplicationIdentifierAsync(
    projectFullName,
    {
      legacyOnly: true,
    }
  );
}

export async function createKeystoreAsync(
  account: Account,
  keystore: KeystoreWithType
): Promise<AndroidKeystoreFragment> {
  return await AndroidKeystoreMutation.createAndroidKeystore(
    {
      base64EncodedKeystore: keystore.keystore,
      keystorePassword: keystore.keystorePassword,
      keyAlias: keystore.keyAlias,
      keyPassword: keystore.keyPassword,
      type: keystore.type,
    },
    account.id
  );
}

const formatProjectFullName = ({ account, projectName }: AppLookupParams): string =>
  `@${account.name}/${projectName}`;
