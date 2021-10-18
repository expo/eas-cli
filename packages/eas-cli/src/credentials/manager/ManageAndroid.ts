import { Platform } from '@expo/eas-build-job';
import { AndroidBuildProfile } from '@expo/eas-json';
import assert from 'assert';

import Log, { learnMore } from '../../log';
import { GradleBuildContext, resolveGradleBuildContextAsync } from '../../project/android/gradle';
import {
  getProjectAccountName,
  promptToCreateProjectIfNotExistsAsync,
} from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { findAccountByName } from '../../user/Account';
import { ensureActorHasUsername } from '../../user/actions';
import { AssignFcm } from '../android/actions/AssignFcm';
import { AssignGoogleServiceAccountKey } from '../android/actions/AssignGoogleServiceAccountKey';
import {
  canCopyLegacyCredentialsAsync,
  getAppLookupParamsFromContextAsync,
  promptUserAndCopyLegacyCredentialsAsync,
} from '../android/actions/BuildCredentialsUtils';
import { CreateFcm } from '../android/actions/CreateFcm';
import { CreateGoogleServiceAccountKey } from '../android/actions/CreateGoogleServiceAccountKey';
import { CreateKeystore } from '../android/actions/CreateKeystore';
import { DownloadKeystore } from '../android/actions/DownloadKeystore';
import { RemoveFcm } from '../android/actions/RemoveFcm';
import { SelectAndRemoveGoogleServiceAccountKey } from '../android/actions/RemoveGoogleServiceAccountKey';
import { RemoveKeystore } from '../android/actions/RemoveKeystore';
import { SetupBuildCredentialsFromCredentialsJson } from '../android/actions/SetupBuildCredentialsFromCredentialsJson';
import { SetupGoogleServiceAccountKey } from '../android/actions/SetupGoogleServiceAccountKey';
import { UpdateCredentialsJson } from '../android/actions/UpdateCredentialsJson';
import { UseExistingGoogleServiceAccountKey } from '../android/actions/UseExistingGoogleServiceAccountKey';
import {
  displayAndroidAppCredentials,
  displayEmptyAndroidCredentials,
} from '../android/utils/printCredentials';
import { CredentialsContext } from '../context';
import { Action, PressAnyKeyToContinue } from './HelperActions';
import {
  SelectAndroidBuildCredentials,
  SelectAndroidBuildCredentialsResultType,
  SelectExistingAndroidBuildCredentials,
} from './SelectAndroidBuildCredentials';
import { SelectBuildProfileFromEasJson } from './SelectBuildProfileFromEasJson';

enum ActionType {
  ManageBuildCredentials,
  ManageFcm,
  ManageGoogleServiceAccountKey,
  ManageCredentialsJson,
  GoBackToCaller,
  GoBackToHighLevelActions,
  CreateKeystore,
  DownloadKeystore,
  RemoveKeystore,
  CreateFcm,
  RemoveFcm,
  CreateGsaKey,
  UseExistingGsaKey,
  RemoveGsaKey,
  SetupGsaKey,
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
    value: ActionType.ManageGoogleServiceAccountKey,
    title: 'Google Service Account: Manage your Service Account Key',
    scope: Scope.Manager,
  },
  {
    value: ActionType.ManageCredentialsJson,
    title: 'credentials.json: Upload/Download credentials between EAS servers and your local json ',
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

const gsaKeyActions: ActionInfo[] = [
  {
    value: ActionType.SetupGsaKey,
    title: 'Setup a Google Service Account Key',
    scope: Scope.Project,
  },
  {
    value: ActionType.CreateGsaKey,
    title: 'Upload a Google Service Account Key',
    scope: Scope.Project,
  },
  {
    value: ActionType.UseExistingGsaKey,
    title: 'Use an existing Google Service Account Key',
    scope: Scope.Project,
  },
  {
    value: ActionType.RemoveGsaKey,
    title: 'Delete a Google Service Account Key',
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

  async runAsync(
    ctx: CredentialsContext,
    currentActions: ActionInfo[] = highLevelActions
  ): Promise<void> {
    const accountName = ctx.hasProjectContext
      ? getProjectAccountName(ctx.exp, ctx.user)
      : ensureActorHasUsername(ctx.user);
    const account = findAccountByName(ctx.user.accounts, accountName);
    if (!account) {
      throw new Error(`You do not have access to account: ${accountName}`);
    }
    const { gradleContext } = await this.createProjectContextAsync(ctx);

    while (true) {
      try {
        if (ctx.hasProjectContext) {
          const maybeProjectId = await promptToCreateProjectIfNotExistsAsync(ctx.exp);
          if (!maybeProjectId) {
            throw new Error(
              'Your project must be registered with EAS in order to use the credentials manager.'
            );
          }
          const appLookupParams = await getAppLookupParamsFromContextAsync(ctx, gradleContext);
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
          } else if (chosenAction === ActionType.ManageGoogleServiceAccountKey) {
            currentActions = gsaKeyActions;
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

        await this.runProjectSpecificActionAsync(ctx, chosenAction, gradleContext);
      } catch (err) {
        Log.error(err);
        if (process.env.DEBUG) {
          throw err; // breaks out of the loop so we can get stack trace
        }
        Log.error(`Cryptic error? ${learnMore('https://expo.fyi/cryptic-error-eas')}`);
      }
      await new PressAnyKeyToContinue().runAsync();
    }
  }

  private async createProjectContextAsync(ctx: CredentialsContext): Promise<{
    gradleContext?: GradleBuildContext;
    buildProfile?: AndroidBuildProfile;
  }> {
    if (!ctx.hasProjectContext) {
      return {};
    }

    const maybeProjectId = await promptToCreateProjectIfNotExistsAsync(ctx.exp);
    if (!maybeProjectId) {
      throw new Error(
        'Your project must be registered with EAS in order to use the credentials manager.'
      );
    }

    const buildProfile = await new SelectBuildProfileFromEasJson(
      ctx.projectDir,
      Platform.ANDROID
    ).runAsync(ctx);
    const gradleContext = await resolveGradleBuildContextAsync(ctx.projectDir, buildProfile);
    return {
      gradleContext,
      buildProfile,
    };
  }

  private async runProjectSpecificActionAsync(
    ctx: CredentialsContext,
    action: ActionType,
    gradleContext?: GradleBuildContext
  ): Promise<void> {
    assert(
      ctx.hasProjectContext,
      'You must be in your project directory in order to perform this action'
    );
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx, gradleContext);
    if (action === ActionType.CreateKeystore) {
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
    } else if (action === ActionType.DownloadKeystore) {
      const buildCredentials = await new SelectExistingAndroidBuildCredentials(
        appLookupParams
      ).runAsync(ctx);
      if (buildCredentials) {
        await new DownloadKeystore({ app: appLookupParams }).runAsync(ctx, buildCredentials);
      }
    } else if (action === ActionType.RemoveKeystore) {
      const buildCredentials = await new SelectExistingAndroidBuildCredentials(
        appLookupParams
      ).runAsync(ctx);
      if (buildCredentials) {
        await new RemoveKeystore(appLookupParams).runAsync(ctx, buildCredentials);
      }
    } else if (action === ActionType.CreateFcm) {
      const fcm = await new CreateFcm(appLookupParams.account).runAsync(ctx);
      await new AssignFcm(appLookupParams).runAsync(ctx, fcm);
    } else if (action === ActionType.RemoveFcm) {
      await new RemoveFcm(appLookupParams).runAsync(ctx);
    } else if (action === ActionType.CreateGsaKey) {
      const gsaKey = await new CreateGoogleServiceAccountKey(appLookupParams.account).runAsync(ctx);
      await new AssignGoogleServiceAccountKey(appLookupParams).runAsync(ctx, gsaKey);
    } else if (action === ActionType.UseExistingGsaKey) {
      const gsaKey = await new UseExistingGoogleServiceAccountKey(appLookupParams.account).runAsync(
        ctx
      );
      if (gsaKey) {
        await new AssignGoogleServiceAccountKey(appLookupParams).runAsync(ctx, gsaKey);
      }
    } else if (action === ActionType.RemoveGsaKey) {
      await new SelectAndRemoveGoogleServiceAccountKey(appLookupParams.account).runAsync(ctx);
    } else if (action === ActionType.SetupGsaKey) {
      await new SetupGoogleServiceAccountKey(appLookupParams).runAsync(ctx);
    } else if (action === ActionType.UpdateCredentialsJson) {
      const buildCredentials = await new SelectExistingAndroidBuildCredentials(
        appLookupParams
      ).runAsync(ctx);
      if (buildCredentials) {
        await new UpdateCredentialsJson().runAsync(ctx, buildCredentials);
      }
    } else if (action === ActionType.SetupBuildCredentialsFromCredentialsJson) {
      await new SetupBuildCredentialsFromCredentialsJson(appLookupParams).runAsync(ctx);
    }
  }
}
