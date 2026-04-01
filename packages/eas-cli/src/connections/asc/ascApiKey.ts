import { selectAsync } from '../../prompts';
import { CredentialsContext } from '../../credentials/context';
import {
  AppStoreApiKeyPurpose,
  formatAscApiKey,
  provideOrGenerateAscApiKeyAsync,
  sortAscApiKeysByUpdatedAtDesc,
} from '../../credentials/ios/actions/AscApiKeyUtils';
import { AccountFragment, AppStoreConnectApiKeyFragment } from '../../graphql/generated';

export async function selectOrCreateAscApiKeyIdAsync({
  credentialsContext,
  existingKeys,
  ownerAccount,
}: {
  credentialsContext: CredentialsContext;
  existingKeys: AppStoreConnectApiKeyFragment[];
  ownerAccount: AccountFragment;
}): Promise<string> {
  const sortedKeys = sortAscApiKeysByUpdatedAtDesc(existingKeys);
  const createKeyOption = {
    title: '[Create or upload a new API key]',
    value: '__create_new_key__',
  };

  const selectedValue =
    sortedKeys.length === 0
      ? createKeyOption.value
      : await selectAsync<string>('Select an App Store Connect API key:', [
          ...sortedKeys.map(key => ({
            title: formatAscApiKey(key),
            value: key.id,
          })),
          createKeyOption,
        ]);

  if (selectedValue !== createKeyOption.value) {
    return selectedValue;
  }

  const newKey = await credentialsContext.ios.createAscApiKeyAsync(
    credentialsContext.graphqlClient,
    ownerAccount,
    await provideOrGenerateAscApiKeyAsync(
      credentialsContext,
      AppStoreApiKeyPurpose.ASC_APP_CONNECTION
    )
  );
  return newKey.id;
}
