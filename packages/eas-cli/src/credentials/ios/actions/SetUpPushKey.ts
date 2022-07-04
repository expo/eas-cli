import assert from 'assert';

import {
  ApplePushKeyFragment,
  CommonIosAppCredentialsFragment,
} from '../../../graphql/generated.js';
import Log from '../../../log.js';
import { confirmAsync, promptAsync } from '../../../prompts.js';
import { nullthrows } from '../../../utils/nullthrows.js';
import { CredentialsContext } from '../../context.js';
import { AppLookupParams } from '../api/GraphqlClient.js';
import { AssignPushKey } from './AssignPushKey.js';
import { CreatePushKey } from './CreatePushKey.js';
import {
  formatPushKey,
  getValidAndTrackedPushKeysOnEasServersAsync,
  selectPushKeyAsync,
} from './PushKeyUtils.js';

export class SetUpPushKey {
  constructor(private app: AppLookupParams) {}

  async isPushKeySetupAsync(ctx: CredentialsContext): Promise<boolean> {
    const pushKey = await ctx.ios.getPushKeyForAppAsync(this.app);
    return !!pushKey;
  }

  public async runAsync(ctx: CredentialsContext): Promise<CommonIosAppCredentialsFragment | null> {
    if (ctx.nonInteractive) {
      throw new Error(`Push keys cannot be setup in non-interactive mode.`);
    }

    const isPushKeySetup = await this.isPushKeySetupAsync(ctx);
    if (isPushKeySetup) {
      return await ctx.ios.getIosAppCredentialsWithCommonFieldsAsync(this.app);
    }

    const pushKeysForAccount = await ctx.ios.getPushKeysForAccountAsync(this.app.account);
    let pushKey: ApplePushKeyFragment;
    if (pushKeysForAccount.length === 0) {
      pushKey = await new CreatePushKey(this.app.account).runAsync(ctx);
    } else {
      pushKey = await this.createOrReusePushKeyAsync(ctx);
    }
    return await new AssignPushKey(this.app).runAsync(ctx, pushKey);
  }

  private async createOrReusePushKeyAsync(ctx: CredentialsContext): Promise<ApplePushKeyFragment> {
    const pushKeysForAccount = await ctx.ios.getPushKeysForAccountAsync(this.app.account);
    assert(
      pushKeysForAccount.length > 0,
      'createOrReusePushKeyAsync: There are no Push Keys available in your EAS account.'
    );

    if (ctx.appStore.authCtx) {
      // only provide autoselect if we can find a push key that is certainly valid
      const validPushKeys = ctx.appStore.authCtx
        ? await getValidAndTrackedPushKeysOnEasServersAsync(ctx, pushKeysForAccount)
        : [];
      if (validPushKeys.length > 0) {
        const autoselectedPushKey = validPushKeys[0];

        const useAutoselected = await confirmAsync({
          message: `Reuse this Push Key?\n${formatPushKey(
            autoselectedPushKey,
            validPushKeys.map(pushKey => pushKey.keyIdentifier)
          )}`,
        });

        if (useAutoselected) {
          Log.log(`Using push key with ID ${autoselectedPushKey.keyIdentifier}`);
          return autoselectedPushKey;
        }
      }
    }

    const { action } = await promptAsync({
      type: 'select',
      name: 'action',
      message: 'Select the Apple Push Key to use for your project:',
      choices: [
        {
          title: '[Choose another existing push key] (Recommended)',
          value: 'CHOOSE_EXISTING',
        },
        { title: '[Add a new push key]', value: 'GENERATE' },
      ],
    });

    if (action === 'GENERATE') {
      return await new CreatePushKey(this.app.account).runAsync(ctx);
    } else {
      return nullthrows(await selectPushKeyAsync(ctx, this.app.account));
    }
  }
}
