import Log from '../../log';
import { getProjectAccountName } from '../../project/projectUtils';
import { findAccountByName } from '../../user/Account';
import { ensureActorHasUsername } from '../../user/actions';
import { Action, CredentialsManager } from '../CredentialsManager';
import { getAppLookupParamsFromContext } from '../android/actions/BuildCredentialsUtils';
import {
  displayAndroidAppCredentials,
  displayEmptyAndroidCredentials,
} from '../android/utils/printCredentialsBeta';
import { Context } from '../context';
import { PressAnyKeyToContinue } from './HelperActions';

enum ActionType {}

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
          throw new Error('Not Implemented Yet');
        }
      } catch (err) {
        Log.error(err);
        await manager.runActionAsync(new PressAnyKeyToContinue());
      }
    }
  }
}
