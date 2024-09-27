import assert from 'assert';
import nullthrows from 'nullthrows';

import {
  AppStoreApiKeyPurpose,
  formatAscApiKey,
  getAscApiKeysFromAccountAsync,
  selectAscApiKeysFromAccountAsync,
  sortAscApiKeysByUpdatedAtDesc,
} from './AscApiKeyUtils';
import { AssignAscApiKey } from './AssignAscApiKey';
import { CreateAscApiKey } from './CreateAscApiKey';
import {
  AppStoreConnectApiKeyFragment,
  CommonIosAppCredentialsFragment,
} from '../../../graphql/generated';
import Log from '../../../log';
import { confirmAsync, promptAsync } from '../../../prompts';
import { CredentialsContext } from '../../context';
import {
  MissingCredentialsNonInteractiveError,
  UnsupportedCredentialsChoiceError,
} from '../../errors';
import { AppLookupParams } from '../api/graphql/types/AppLookupParams';
import { getValidAndTrackedAscApiKeysAsync } from '../validators/validateAscApiKey';

export enum SetupAscApiKeyChoice {
  GENERATE = 'GENERATE',
  USE_EXISTING = 'USE_EXISTING',
}
export class SetUpAscApiKey {
  public choices: { title: string; value: string }[] = [
    {
      title: '[Choose an existing key]',
      value: SetupAscApiKeyChoice.USE_EXISTING,
    },
    { title: '[Add a new key]', value: SetupAscApiKeyChoice.GENERATE },
  ];

  constructor(
    private readonly app: AppLookupParams,
    private readonly purpose: AppStoreApiKeyPurpose
  ) {}

  public async runAsync(ctx: CredentialsContext): Promise<CommonIosAppCredentialsFragment> {
    const isKeySetup = await this.isAscApiKeySetupAsync(ctx, this.purpose);
    if (isKeySetup) {
      Log.succeed('App Store Connect API Key already set up.');
      return nullthrows(
        await ctx.ios.getIosAppCredentialsWithCommonFieldsAsync(ctx.graphqlClient, this.app),
        'iosAppCredentials cannot be null if App Store Connect API Key is already set up'
      );
    }
    if (ctx.nonInteractive) {
      throw new MissingCredentialsNonInteractiveError(
        'App Store Connect API Keys cannot be set up in --non-interactive mode.'
      );
    }

    const keysForAccount = await getAscApiKeysFromAccountAsync(ctx, this.app.account, {
      filterDifferentAppleTeam: true,
    });
    const maybeAutoselectedKey = await this.doBestEffortAutoselectAsync(ctx, keysForAccount);
    if (maybeAutoselectedKey) {
      return await new AssignAscApiKey(this.app).runAsync(ctx, maybeAutoselectedKey, this.purpose);
    }

    const availableChoices =
      keysForAccount.length === 0
        ? this.choices.filter(choice => choice.value !== SetupAscApiKeyChoice.USE_EXISTING)
        : this.choices;
    const ascApiKey = await this.processChoicesAsync(ctx, this.purpose, availableChoices);
    return await new AssignAscApiKey(this.app).runAsync(ctx, ascApiKey, this.purpose);
  }

  private async doBestEffortAutoselectAsync(
    ctx: CredentialsContext,
    keysForAccount: AppStoreConnectApiKeyFragment[]
  ): Promise<AppStoreConnectApiKeyFragment | null> {
    if (!ctx.appStore.authCtx) {
      return null;
    }
    if (keysForAccount.length === 0) {
      return null;
    }

    // only provide autoselect if we can find a key that is certainly valid
    const validKeys = await getValidAndTrackedAscApiKeysAsync(ctx, keysForAccount);
    if (validKeys.length === 0) {
      return null;
    }
    const [autoselectedKey] = sortAscApiKeysByUpdatedAtDesc(validKeys);
    const useAutoselected = await confirmAsync({
      message: `Reuse this App Store Connect API Key?\n${formatAscApiKey(autoselectedKey)}`,
    });

    if (useAutoselected) {
      Log.log(`Using App Store Connect API Key with ID ${autoselectedKey.keyIdentifier}`);
      return autoselectedKey;
    } else {
      return null;
    }
  }

  private async isAscApiKeySetupAsync(
    ctx: CredentialsContext,
    purpose: AppStoreApiKeyPurpose
  ): Promise<boolean> {
    const appCredentials = await ctx.ios.getIosAppCredentialsWithCommonFieldsAsync(
      ctx.graphqlClient,
      this.app
    );
    if (purpose !== AppStoreApiKeyPurpose.SUBMISSION_SERVICE) {
      throw new Error(`App Store Connect API Key setup is not yet supported for ${purpose}.`);
    }
    return !!appCredentials?.appStoreConnectApiKeyForSubmissions;
  }

  private async processChoicesAsync(
    ctx: CredentialsContext,
    purpose: AppStoreApiKeyPurpose,
    choices: { title: string; value: string }[]
  ): Promise<AppStoreConnectApiKeyFragment> {
    assert(choices.length > 0, 'SetupAscApiKey: There must be at least one choice');
    let choice: string;
    if (choices.length === 1) {
      choice = choices[0].value;
    } else {
      const result = await promptAsync({
        type: 'select',
        name: 'choice',
        message: 'Select the App Store Connect Api Key to use for your project:',
        choices,
      });
      choice = result.choice;
    }

    if (choice === SetupAscApiKeyChoice.GENERATE) {
      return await new CreateAscApiKey(this.app.account).runAsync(ctx, purpose);
    } else if (choice === SetupAscApiKeyChoice.USE_EXISTING) {
      const selectedAscApiKey = await selectAscApiKeysFromAccountAsync(ctx, this.app.account, {
        filterDifferentAppleTeam: true,
      });
      if (!selectedAscApiKey) {
        return await this.processChoicesAsync(ctx, purpose, choices);
      }
      return selectedAscApiKey;
    }
    throw new UnsupportedCredentialsChoiceError(
      `AscApiKey Setup does not support choice:${choice}`,
      choice
    );
  }
}
