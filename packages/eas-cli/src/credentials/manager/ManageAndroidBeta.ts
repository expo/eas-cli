import Log from '../../log';
import { getProjectAccountName } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { findAccountByName } from '../../user/Account';
import { ensureActorHasUsername } from '../../user/actions';
import { Action, CredentialsManager } from '../CredentialsManager';
import { getAppLookupParamsFromContext } from '../android/actions/BuildCredentialsUtils';
import { CreateKeystore } from '../android/actions/new/CreateKeystore';
import {
  displayAndroidAppCredentials,
  displayEmptyAndroidCredentials,
} from '../android/utils/printCredentialsBeta';
import { Context } from '../context';
import { PressAnyKeyToContinue } from './HelperActions';
import {
  SelectAndroidBuildCredentials,
  SelectAndroidBuildCredentialsResultType,
} from './SelectAndroidBuildCredentials';

enum ActionType {
  CreateKeystore,
}

enum Scope {
  Project,
  Account,
  Manager,
}

type ActionInfo = { value: ActionType; title: string; scope: Scope };

const highLevelActions: ActionInfo[] = [];

export class ManageAndroid implements Action {
  async runAsync(
    manager: CredentialsManager,
    ctx: Context,
    _currentActions: ActionInfo[] = highLevelActions
  ): Promise<void> {
    while (true) {
      try {
        const accountName = ctx.hasProjectContext
          ? getProjectAccountName(ctx.exp, ctx.user)
          : ensureActorHasUsername(ctx.user);

        const account = findAccountByName(ctx.user.accounts, accountName);
        if (!account) {
          throw new Error(`You do not have access to account: ${accountName}`);
        }
        if (ctx.hasProjectContext) {
          const appLookupParams = getAppLookupParamsFromContext(ctx);
          const legacyAppCredentials = await ctx.newAndroid.getLegacyAndroidAppCredentialsWithCommonFieldsAsync(
            appLookupParams
          );
          const appCredentials = await ctx.newAndroid.getAndroidAppCredentialsWithCommonFieldsAsync(
            appLookupParams
          );
          if (!legacyAppCredentials && !appCredentials) {
            displayEmptyAndroidCredentials(appLookupParams);
          } else {
            displayAndroidAppCredentials({ appLookupParams, legacyAppCredentials, appCredentials });
          }
        }
        const actions: { value: ActionType; title: string }[] = [
          {
            value: ActionType.CreateKeystore,
            title: 'Set up a new keystore',
          },
        ];
        const { action: chosenAction } = await promptAsync({
          type: 'select',
          name: 'action',
          message: 'What do you want to do?',
          choices: actions,
        });
        if (chosenAction === ActionType.CreateKeystore) {
          const appLookupParams = getAppLookupParamsFromContext(ctx);
          const selectBuildCredentialsResult = await new SelectAndroidBuildCredentials(
            appLookupParams
          ).runAsync(ctx);
          const keystore = await new CreateKeystore(appLookupParams.account).runAsync(ctx);
          if (
            selectBuildCredentialsResult.resultType ===
            SelectAndroidBuildCredentialsResultType.CREATE_REQUEST
          ) {
            await ctx.newAndroid.createAndroidAppBuildCredentialsAsync(appLookupParams, {
              ...selectBuildCredentialsResult.result,
              androidKeystoreId: keystore.id,
            });
          } else {
            await ctx.newAndroid.updateAndroidAppBuildCredentialsAsync(
              selectBuildCredentialsResult.result,
              {
                androidKeystoreId: keystore.id,
              }
            );
          }
        }
      } catch (err) {
        Log.error(err);
        await manager.runActionAsync(new PressAnyKeyToContinue());
      }
    }
  }
}
