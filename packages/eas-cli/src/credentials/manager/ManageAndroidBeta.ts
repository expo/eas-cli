import Log from '../../log';
import { getProjectAccountName } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { findAccountByName } from '../../user/Account';
import { ensureActorHasUsername } from '../../user/actions';
import { Action, CredentialsManager } from '../CredentialsManager';
import {
  canCopyLegacyCredentialsAsync,
  getAppLookupParamsFromContext,
  promptUserAndCopyLegacyCredentialsAsync,
} from '../android/actions/BuildCredentialsUtils';
import { AssignFcm } from '../android/actions/new/AssignFcm';
import { CreateFcm } from '../android/actions/new/CreateFcm';
import { CreateKeystore } from '../android/actions/new/CreateKeystore';
import { DownloadKeystore } from '../android/actions/new/DownloadKeystore';
import { RemoveFcm } from '../android/actions/new/RemoveFcm';
import { RemoveKeystore } from '../android/actions/new/RemoveKeystore';
import { SetupBuildCredentialsFromCredentialsJson } from '../android/actions/new/SetupBuildCredentialsFromCredentialsJson';
import { UpdateCredentialsJson } from '../android/actions/new/UpdateCredentialsJson';
import {
  displayAndroidAppCredentials,
  displayEmptyAndroidCredentials,
} from '../android/utils/printCredentialsBeta';
import { Context } from '../context';
import { PressAnyKeyToContinue } from './HelperActions';
import {
  SelectAndroidBuildCredentials,
  SelectAndroidBuildCredentialsResultType,
  SelectExistingAndroidBuildCredentials,
} from './SelectAndroidBuildCredentials';

enum ActionType {
  CreateKeystore,
  DownloadKeystore,
  RemoveKeystore,
  CreateFcm,
  RemoveFcm,
  UpdateCredentialsJson,
  SetupBuildCredentialsFromCredentialsJson,
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
          const appCredentials = await ctx.newAndroid.getAndroidAppCredentialsWithCommonFieldsAsync(
            appLookupParams
          );
          if (!appCredentials) {
            displayEmptyAndroidCredentials(appLookupParams);
          } else {
            displayAndroidAppCredentials({ appLookupParams, appCredentials });
          }

          // copy legacy credentials if user is new to EAS and has legacy credentials
          const canCopyLegacyCredentials = await canCopyLegacyCredentialsAsync(
            ctx,
            appLookupParams
          );
          if (canCopyLegacyCredentials) {
            await promptUserAndCopyLegacyCredentialsAsync(ctx, appLookupParams);
          }
        }
        const actions: { value: ActionType; title: string }[] = [
          {
            value: ActionType.CreateKeystore,
            title: 'Set up a new keystore',
          },
          {
            value: ActionType.DownloadKeystore,
            title: 'Download existing keystore',
          },
          {
            value: ActionType.RemoveKeystore,
            title: 'Delete your keystore',
          },
          {
            value: ActionType.CreateFcm,
            title: 'Upload an FCM Api Key',
          },
          {
            value: ActionType.RemoveFcm,
            title: 'Delete your FCM Api Key',
          },
          {
            value: ActionType.UpdateCredentialsJson,
            title: 'Update credentials.json with values from EAS servers',
          },
          {
            value: ActionType.SetupBuildCredentialsFromCredentialsJson,
            title: 'Update credentials on EAS servers with values from credentials.json',
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
        } else if (chosenAction === ActionType.DownloadKeystore) {
          const appLookupParams = getAppLookupParamsFromContext(ctx);
          const buildCredentials = await new SelectExistingAndroidBuildCredentials(
            appLookupParams
          ).runAsync(ctx);
          if (buildCredentials) {
            await new DownloadKeystore({ app: appLookupParams }).runAsync(ctx, buildCredentials);
          }
        } else if (chosenAction === ActionType.RemoveKeystore) {
          const appLookupParams = getAppLookupParamsFromContext(ctx);
          const buildCredentials = await new SelectExistingAndroidBuildCredentials(
            appLookupParams
          ).runAsync(ctx);
          if (buildCredentials) {
            await new RemoveKeystore(appLookupParams).runAsync(ctx, buildCredentials);
          }
        } else if (chosenAction === ActionType.CreateFcm) {
          const appLookupParams = getAppLookupParamsFromContext(ctx);
          const fcm = await new CreateFcm(appLookupParams.account).runAsync(ctx);
          await new AssignFcm(appLookupParams).runAsync(ctx, fcm);
        } else if (chosenAction === ActionType.RemoveFcm) {
          const appLookupParams = getAppLookupParamsFromContext(ctx);
          await new RemoveFcm(appLookupParams).runAsync(ctx);
        } else if (chosenAction === ActionType.UpdateCredentialsJson) {
          const appLookupParams = getAppLookupParamsFromContext(ctx);
          const buildCredentials = await new SelectExistingAndroidBuildCredentials(
            appLookupParams
          ).runAsync(ctx);
          if (buildCredentials) {
            await new UpdateCredentialsJson().runAsync(ctx, buildCredentials);
          }
        } else if (chosenAction === ActionType.SetupBuildCredentialsFromCredentialsJson) {
          const appLookupParams = getAppLookupParamsFromContext(ctx);
          await new SetupBuildCredentialsFromCredentialsJson(appLookupParams).runAsync(ctx);
        }
      } catch (err) {
        Log.error(err);
      }
      await manager.runActionAsync(new PressAnyKeyToContinue());
    }
  }
}
