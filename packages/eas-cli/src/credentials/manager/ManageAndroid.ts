import Log from '../../log';
import { getProjectAccountName } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { findAccountByName } from '../../user/Account';
import { ensureActorHasUsername } from '../../user/actions';
import { AssignFcm } from '../android/actions/AssignFcm';
import {
  canCopyLegacyCredentialsAsync,
  getAppLookupParamsFromContextAsync,
  promptUserAndCopyLegacyCredentialsAsync,
} from '../android/actions/BuildCredentialsUtils';
import { CreateFcm } from '../android/actions/CreateFcm';
import { CreateKeystore } from '../android/actions/CreateKeystore';
import { DownloadKeystore } from '../android/actions/DownloadKeystore';
import { RemoveFcm } from '../android/actions/RemoveFcm';
import { RemoveKeystore } from '../android/actions/RemoveKeystore';
import { SetupBuildCredentialsFromCredentialsJson } from '../android/actions/SetupBuildCredentialsFromCredentialsJson';
import { UpdateCredentialsJson } from '../android/actions/UpdateCredentialsJson';
import {
  displayAndroidAppCredentials,
  displayEmptyAndroidCredentials,
} from '../android/utils/printCredentials';
import { Action, Context } from '../context';
import { PressAnyKeyToContinue } from './HelperActions';
import {
  SelectAndroidBuildCredentials,
  SelectAndroidBuildCredentialsResultType,
  SelectExistingAndroidBuildCredentials,
} from './SelectAndroidBuildCredentials';

enum ActionType {
  ManageBuildCredentials,
  ManageFcm,
  ManageCredentialsJson,
  GoBackToCaller,
  GoBackToHighLevelActions,
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
  Manager,
}

type ActionInfo = { value: ActionType; title: string; scope: Scope };

const highLevelActions: ActionInfo[] = [
  {
    value: ActionType.ManageBuildCredentials,
    title: 'Keystore: Manage everything needed to build your project',
    scope: Scope.Manager,
  },
  {
    value: ActionType.ManageFcm,
    title: 'Push Notifications: Manage your FCM Api Key',
    scope: Scope.Manager,
  },
  {
    value: ActionType.ManageCredentialsJson,
    title: 'Credentials.json: Upload/Download credentials between EAS servers and your local json ',
    scope: Scope.Manager,
  },
  {
    value: ActionType.GoBackToCaller,
    title: 'Go back',
    scope: Scope.Manager,
  },
];

const credentialsJsonActions: ActionInfo[] = [
  {
    value: ActionType.UpdateCredentialsJson,
    title: 'Download credentials from EAS to credentials.json',
    scope: Scope.Project,
  },
  {
    value: ActionType.SetupBuildCredentialsFromCredentialsJson,
    title: 'Upload credentials from credentials.json to EAS',
    scope: Scope.Project,
  },
  {
    value: ActionType.GoBackToHighLevelActions,
    title: 'Go back',
    scope: Scope.Manager,
  },
];

const buildCredentialsActions: ActionInfo[] = [
  {
    value: ActionType.CreateKeystore,
    title: 'Set up a new keystore',
    scope: Scope.Project,
  },
  {
    value: ActionType.DownloadKeystore,
    title: 'Download existing keystore',
    scope: Scope.Project,
  },
  {
    value: ActionType.RemoveKeystore,
    title: 'Delete your keystore',
    scope: Scope.Project,
  },
  {
    value: ActionType.GoBackToHighLevelActions,
    title: 'Go back',
    scope: Scope.Manager,
  },
];

const fcmActions: ActionInfo[] = [
  {
    value: ActionType.CreateFcm,
    title: 'Upload an FCM Api Key',
    scope: Scope.Project,
  },
  {
    value: ActionType.RemoveFcm,
    title: 'Delete your FCM Api Key',
    scope: Scope.Project,
  },
  {
    value: ActionType.GoBackToHighLevelActions,
    title: 'Go back',
    scope: Scope.Manager,
  },
];

export class ManageAndroid {
  constructor(private callingAction: Action) {}

  async runAsync(ctx: Context, currentActions: ActionInfo[] = highLevelActions): Promise<void> {
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
          const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
          const appCredentials = await ctx.android.getAndroidAppCredentialsWithCommonFieldsAsync(
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
        const { action: chosenAction } = await promptAsync({
          type: 'select',
          name: 'action',
          message: 'What do you want to do?',
          choices: currentActions.map(action => ({
            value: action.value,
            title: action.title,
          })),
        });
        const actionInfo = currentActions.find(action => action.value === chosenAction);
        if (!actionInfo) {
          throw new Error('Action not supported yet');
        }
        if (actionInfo.scope === Scope.Manager) {
          if (chosenAction === ActionType.ManageBuildCredentials) {
            currentActions = buildCredentialsActions;
            continue;
          } else if (chosenAction === ActionType.ManageFcm) {
            currentActions = fcmActions;
            continue;
          } else if (chosenAction === ActionType.ManageCredentialsJson) {
            currentActions = credentialsJsonActions;
            continue;
          } else if (chosenAction === ActionType.GoBackToHighLevelActions) {
            currentActions = highLevelActions;
            continue;
          } else if (chosenAction === ActionType.GoBackToCaller) {
            return await this.callingAction.runAsync(ctx);
          }
        }
        const appLookupParams = await getAppLookupParamsFromContextAsync(ctx);
        if (chosenAction === ActionType.CreateKeystore) {
          const selectBuildCredentialsResult = await new SelectAndroidBuildCredentials(
            appLookupParams
          ).runAsync(ctx);
          const keystore = await new CreateKeystore(appLookupParams.account).runAsync(ctx);
          if (
            selectBuildCredentialsResult.resultType ===
            SelectAndroidBuildCredentialsResultType.CREATE_REQUEST
          ) {
            await ctx.android.createAndroidAppBuildCredentialsAsync(appLookupParams, {
              ...selectBuildCredentialsResult.result,
              androidKeystoreId: keystore.id,
            });
          } else {
            await ctx.android.updateAndroidAppBuildCredentialsAsync(
              selectBuildCredentialsResult.result,
              {
                androidKeystoreId: keystore.id,
              }
            );
          }
        } else if (chosenAction === ActionType.DownloadKeystore) {
          const buildCredentials = await new SelectExistingAndroidBuildCredentials(
            appLookupParams
          ).runAsync(ctx);
          if (buildCredentials) {
            await new DownloadKeystore({ app: appLookupParams }).runAsync(ctx, buildCredentials);
          }
        } else if (chosenAction === ActionType.RemoveKeystore) {
          const buildCredentials = await new SelectExistingAndroidBuildCredentials(
            appLookupParams
          ).runAsync(ctx);
          if (buildCredentials) {
            await new RemoveKeystore(appLookupParams).runAsync(ctx, buildCredentials);
          }
        } else if (chosenAction === ActionType.CreateFcm) {
          const fcm = await new CreateFcm(appLookupParams.account).runAsync(ctx);
          await new AssignFcm(appLookupParams).runAsync(ctx, fcm);
        } else if (chosenAction === ActionType.RemoveFcm) {
          await new RemoveFcm(appLookupParams).runAsync(ctx);
        } else if (chosenAction === ActionType.UpdateCredentialsJson) {
          const buildCredentials = await new SelectExistingAndroidBuildCredentials(
            appLookupParams
          ).runAsync(ctx);
          if (buildCredentials) {
            await new UpdateCredentialsJson().runAsync(ctx, buildCredentials);
          }
        } else if (chosenAction === ActionType.SetupBuildCredentialsFromCredentialsJson) {
          await new SetupBuildCredentialsFromCredentialsJson(appLookupParams).runAsync(ctx);
        }
      } catch (err) {
        Log.error(err);
      }
      await new PressAnyKeyToContinue().runAsync();
    }
  }
}
