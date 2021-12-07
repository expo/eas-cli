import { Platform } from '@expo/eas-build-job';
import { BuildProfile } from '@expo/eas-json';
import assert from 'assert';

import Log, { learnMore } from '../../log';
import { GradleBuildContext, resolveGradleBuildContextAsync } from '../../project/android/gradle';
import {
  getProjectAccountName,
  promptToCreateProjectIfNotExistsAsync,
} from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { findAccountByName } from '../../user/Account';
import { ensureActorHasUsername, ensureLoggedInAsync } from '../../user/actions';
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
import { SetUpBuildCredentialsFromCredentialsJson } from '../android/actions/SetUpBuildCredentialsFromCredentialsJson';
import { SetUpGoogleServiceAccountKey } from '../android/actions/SetUpGoogleServiceAccountKey';
import { UpdateCredentialsJson } from '../android/actions/UpdateCredentialsJson';
import { UseExistingGoogleServiceAccountKey } from '../android/actions/UseExistingGoogleServiceAccountKey';
import {
  displayAndroidAppCredentials,
  displayEmptyAndroidCredentials,
} from '../android/utils/printCredentials';
import { CredentialsContext, hasProjectContext } from '../context';
import { ActionInfo, AndroidActionType, Scope } from './Actions';
import {
  buildCredentialsActions,
  credentialsJsonActions,
  fcmActions,
  gsaKeyActions,
  highLevelActions,
} from './AndroidActions';
import { Action, PressAnyKeyToContinue } from './HelperActions';
import {
  SelectAndroidBuildCredentials,
  SelectAndroidBuildCredentialsResultType,
  SelectExistingAndroidBuildCredentials,
} from './SelectAndroidBuildCredentials';
import { SelectBuildProfileFromEasJson } from './SelectBuildProfileFromEasJson';

export class ManageAndroid {
  constructor(private callingAction: Action, private projectDir: string) {}

  async runAsync(currentActions: ActionInfo[] = highLevelActions): Promise<void> {
    const buildProfile = hasProjectContext(this.projectDir)
      ? await new SelectBuildProfileFromEasJson(this.projectDir, Platform.ANDROID).runAsync()
      : null;
    const ctx = new CredentialsContext({
      projectDir: process.cwd(),
      user: await ensureLoggedInAsync(),
      buildProfile: buildProfile ?? undefined,
    });
    const accountName = ctx.hasProjectContext
      ? getProjectAccountName(ctx.exp, ctx.user)
      : ensureActorHasUsername(ctx.user);
    const account = findAccountByName(ctx.user.accounts, accountName);
    if (!account) {
      throw new Error(`You do not have access to account: ${accountName}`);
    }
    const { gradleContext } = await this.createProjectContextAsync(ctx, {
      buildProfile: buildProfile ?? undefined,
    });

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
          if (chosenAction === AndroidActionType.ManageBuildCredentials) {
            currentActions = buildCredentialsActions;
            continue;
          } else if (chosenAction === AndroidActionType.ManageFcm) {
            currentActions = fcmActions;
            continue;
          } else if (chosenAction === AndroidActionType.ManageGoogleServiceAccountKey) {
            currentActions = gsaKeyActions;
            continue;
          } else if (chosenAction === AndroidActionType.ManageCredentialsJson) {
            currentActions = credentialsJsonActions;
            continue;
          } else if (chosenAction === AndroidActionType.GoBackToHighLevelActions) {
            currentActions = highLevelActions;
            continue;
          } else if (chosenAction === AndroidActionType.GoBackToCaller) {
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

  private async createProjectContextAsync(
    ctx: CredentialsContext,
    { buildProfile }: { buildProfile?: BuildProfile<Platform.ANDROID> }
  ): Promise<{
    gradleContext?: GradleBuildContext;
  }> {
    if (!ctx.hasProjectContext) {
      return {};
    }

    assert(buildProfile, 'buildProfile must be defined in project context');
    const maybeProjectId = await promptToCreateProjectIfNotExistsAsync(ctx.exp);
    if (!maybeProjectId) {
      throw new Error(
        'Your project must be registered with EAS in order to use the credentials manager.'
      );
    }
    const gradleContext = await resolveGradleBuildContextAsync(ctx.projectDir, buildProfile);
    return {
      gradleContext,
    };
  }

  private async runProjectSpecificActionAsync(
    ctx: CredentialsContext,
    action: AndroidActionType,
    gradleContext?: GradleBuildContext
  ): Promise<void> {
    assert(
      ctx.hasProjectContext,
      'You must be in your project directory in order to perform this action'
    );
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx, gradleContext);
    if (action === AndroidActionType.CreateKeystore) {
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
    } else if (action === AndroidActionType.DownloadKeystore) {
      const buildCredentials = await new SelectExistingAndroidBuildCredentials(
        appLookupParams
      ).runAsync(ctx);
      if (buildCredentials) {
        await new DownloadKeystore({ app: appLookupParams }).runAsync(ctx, buildCredentials);
      }
    } else if (action === AndroidActionType.RemoveKeystore) {
      const buildCredentials = await new SelectExistingAndroidBuildCredentials(
        appLookupParams
      ).runAsync(ctx);
      if (buildCredentials) {
        await new RemoveKeystore(appLookupParams).runAsync(ctx, buildCredentials);
      }
    } else if (action === AndroidActionType.CreateFcm) {
      const fcm = await new CreateFcm(appLookupParams.account).runAsync(ctx);
      await new AssignFcm(appLookupParams).runAsync(ctx, fcm);
    } else if (action === AndroidActionType.RemoveFcm) {
      await new RemoveFcm(appLookupParams).runAsync(ctx);
    } else if (action === AndroidActionType.CreateGsaKey) {
      const gsaKey = await new CreateGoogleServiceAccountKey(appLookupParams.account).runAsync(ctx);
      await new AssignGoogleServiceAccountKey(appLookupParams).runAsync(ctx, gsaKey);
    } else if (action === AndroidActionType.UseExistingGsaKey) {
      const gsaKey = await new UseExistingGoogleServiceAccountKey(appLookupParams.account).runAsync(
        ctx
      );
      if (gsaKey) {
        await new AssignGoogleServiceAccountKey(appLookupParams).runAsync(ctx, gsaKey);
      }
    } else if (action === AndroidActionType.RemoveGsaKey) {
      await new SelectAndRemoveGoogleServiceAccountKey(appLookupParams.account).runAsync(ctx);
    } else if (action === AndroidActionType.SetUpGsaKey) {
      await new SetUpGoogleServiceAccountKey(appLookupParams).runAsync(ctx);
    } else if (action === AndroidActionType.UpdateCredentialsJson) {
      const buildCredentials = await new SelectExistingAndroidBuildCredentials(
        appLookupParams
      ).runAsync(ctx);
      if (buildCredentials) {
        await new UpdateCredentialsJson().runAsync(ctx, buildCredentials);
      }
    } else if (action === AndroidActionType.SetUpBuildCredentialsFromCredentialsJson) {
      await new SetUpBuildCredentialsFromCredentialsJson(appLookupParams).runAsync(ctx);
    }
  }
}
