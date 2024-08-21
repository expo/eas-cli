import { Platform } from '@expo/eas-build-job';
import { BuildProfile } from '@expo/eas-json';
import assert from 'assert';

import { ActionInfo, AndroidActionType, Scope } from './Actions';
import {
  buildCredentialsActions,
  credentialsJsonActions,
  fcmActions,
  gsaActions,
  gsaKeyActionsForFcmV1,
  gsaKeyActionsForSubmissions,
  highLevelActions,
} from './AndroidActions';
import { CreateAndroidBuildCredentials } from './CreateAndroidBuildCredentials';
import { Action, PressAnyKeyToContinue } from './HelperActions';
import { SelectExistingAndroidBuildCredentials } from './SelectAndroidBuildCredentials';
import { SelectBuildProfileFromEasJson } from './SelectBuildProfileFromEasJson';
import { SetDefaultAndroidKeystore } from './SetDefaultAndroidKeystore';
import Log, { learnMore } from '../../log';
import { GradleBuildContext, resolveGradleBuildContextAsync } from '../../project/android/gradle';
import { promptAsync } from '../../prompts';
import { AssignFcm } from '../android/actions/AssignFcm';
import { AssignGoogleServiceAccountKeyForFcmV1 } from '../android/actions/AssignGoogleServiceAccountKeyForFcmV1';
import { AssignGoogleServiceAccountKeyForSubmissions } from '../android/actions/AssignGoogleServiceAccountKeyForSubmissions';
import {
  canCopyLegacyCredentialsAsync,
  getAppLookupParamsFromContextAsync,
  promptUserAndCopyLegacyCredentialsAsync,
} from '../android/actions/BuildCredentialsUtils';
import { CreateFcm } from '../android/actions/CreateFcm';
import { CreateGoogleServiceAccountKey } from '../android/actions/CreateGoogleServiceAccountKey';
import { DownloadKeystore } from '../android/actions/DownloadKeystore';
import { RemoveFcm } from '../android/actions/RemoveFcm';
import { SelectAndRemoveGoogleServiceAccountKey } from '../android/actions/RemoveGoogleServiceAccountKey';
import { RemoveKeystore } from '../android/actions/RemoveKeystore';
import { SetUpBuildCredentials } from '../android/actions/SetUpBuildCredentials';
import { SetUpBuildCredentialsFromCredentialsJson } from '../android/actions/SetUpBuildCredentialsFromCredentialsJson';
import { SetUpGoogleServiceAccountKeyForFcmV1 } from '../android/actions/SetUpGoogleServiceAccountKeyForFcmV1';
import { SetUpGoogleServiceAccountKeyForSubmissions } from '../android/actions/SetUpGoogleServiceAccountKeyForSubmissions';
import { UpdateCredentialsJson } from '../android/actions/UpdateCredentialsJson';
import { UseExistingGoogleServiceAccountKey } from '../android/actions/UseExistingGoogleServiceAccountKey';
import {
  displayAndroidAppCredentials,
  displayEmptyAndroidCredentials,
} from '../android/utils/printCredentials';
import { CredentialsContext, CredentialsContextProjectInfo } from '../context';
import { AndroidPackageNotDefinedError } from '../errors';

export class ManageAndroid {
  constructor(
    protected callingAction: Action,
    protected projectDir: string
  ) {}

  async runAsync(currentActions: ActionInfo[] = highLevelActions): Promise<void> {
    const hasProjectContext = !!this.callingAction.projectInfo;
    const buildProfile = hasProjectContext
      ? await new SelectBuildProfileFromEasJson(this.projectDir, Platform.ANDROID).runAsync()
      : null;
    let projectInfo: CredentialsContextProjectInfo | null = null;
    if (hasProjectContext) {
      const { exp, projectId } = await this.callingAction.getDynamicPrivateProjectConfigAsync({
        env: buildProfile?.env,
      });
      projectInfo = { exp, projectId };
    }
    const ctx = new CredentialsContext({
      projectDir: process.cwd(),
      projectInfo,
      user: this.callingAction.actor,
      graphqlClient: this.callingAction.graphqlClient,
      analytics: this.callingAction.analytics,
      env: buildProfile?.env,
      nonInteractive: false,
      vcsClient: this.callingAction.vcsClient,
    });

    let gradleContext;
    if (ctx.hasProjectContext) {
      assert(buildProfile, 'buildProfile must be defined in a project context');
      gradleContext = await this.createProjectContextAsync(ctx, buildProfile);
    }

    while (true) {
      try {
        if (ctx.hasProjectContext) {
          const appLookupParams = await getAppLookupParamsFromContextAsync(ctx, gradleContext);
          const appCredentials = await ctx.android.getAndroidAppCredentialsWithCommonFieldsAsync(
            ctx.graphqlClient,
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
          } else if (chosenAction === AndroidActionType.ManageGoogleServiceAccount) {
            currentActions = gsaActions;
            continue;
          } else if (
            chosenAction === AndroidActionType.ManageGoogleServiceAccountKeyForSubmissions
          ) {
            currentActions = gsaKeyActionsForSubmissions;
            continue;
          } else if (chosenAction === AndroidActionType.ManageGoogleServiceAccountKeyForFcmV1) {
            currentActions = gsaKeyActionsForFcmV1;
            continue;
          } else if (chosenAction === AndroidActionType.ManageCredentialsJson) {
            currentActions = credentialsJsonActions;
            continue;
          } else if (chosenAction === AndroidActionType.GoBackToHighLevelActions) {
            currentActions = highLevelActions;
            continue;
          } else if (chosenAction === AndroidActionType.GoBackToCaller) {
            await this.callingAction.runAsync(ctx);
            return;
          }
        }

        await this.runProjectSpecificActionAsync(ctx, chosenAction, gradleContext);
      } catch (err) {
        if (err instanceof AndroidPackageNotDefinedError) {
          err.message += `\n${learnMore(
            'https://docs.expo.dev/workflow/configuration/'
          )} about configuration with app.json/app.config.js`;
          throw err; // breaks out of the loop to avoid failing again after continuation
        }
        Log.error(err);
        if (process.env.DEBUG) {
          throw err; // breaks out of the loop so we can get stack trace
        }
        Log.error(`Cryptic error? ${learnMore('https://expo.fyi/cryptic-error-eas')}`);
      }
      await new PressAnyKeyToContinue().runAsync();
    }
  }

  protected async createProjectContextAsync(
    ctx: CredentialsContext,
    buildProfile: BuildProfile<Platform.ANDROID>
  ): Promise<GradleBuildContext | undefined> {
    assert(ctx.hasProjectContext, 'createProjectContextAsync: must have project context.');
    return await resolveGradleBuildContextAsync(ctx.projectDir, buildProfile, ctx.vcsClient);
  }

  protected async runProjectSpecificActionAsync(
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
      await new CreateAndroidBuildCredentials(appLookupParams).runAsync(ctx);
    } else if (action === AndroidActionType.SetDefaultKeystore) {
      await new SetDefaultAndroidKeystore(appLookupParams).runAsync(ctx);
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
    } else if (action === AndroidActionType.SetUpGsaKeyForSubmissions) {
      await new SetUpGoogleServiceAccountKeyForSubmissions(appLookupParams).runAsync(ctx);
    } else if (action === AndroidActionType.UseExistingGsaKeyForSubmissions) {
      const gsaKey = await new UseExistingGoogleServiceAccountKey(appLookupParams.account).runAsync(
        ctx
      );
      if (gsaKey) {
        await new AssignGoogleServiceAccountKeyForSubmissions(appLookupParams).runAsync(
          ctx,
          gsaKey
        );
      }
    } else if (action === AndroidActionType.SetUpGsaKeyForFcmV1) {
      await new SetUpGoogleServiceAccountKeyForFcmV1(appLookupParams).runAsync(ctx);
    } else if (action === AndroidActionType.UseExistingGsaKeyForFcmV1) {
      const gsaKey = await new UseExistingGoogleServiceAccountKey(appLookupParams.account).runAsync(
        ctx
      );
      if (gsaKey) {
        await new AssignGoogleServiceAccountKeyForFcmV1(appLookupParams).runAsync(ctx, gsaKey);
      }
    } else if (action === AndroidActionType.CreateGsaKey) {
      await new CreateGoogleServiceAccountKey(appLookupParams.account).runAsync(ctx);
    } else if (action === AndroidActionType.RemoveGsaKey) {
      await new SelectAndRemoveGoogleServiceAccountKey(appLookupParams.account).runAsync(ctx);
    } else if (action === AndroidActionType.UpdateCredentialsJson) {
      const buildCredentials = await new SelectExistingAndroidBuildCredentials(
        appLookupParams
      ).runAsync(ctx);
      if (buildCredentials) {
        await new UpdateCredentialsJson().runAsync(ctx, buildCredentials);
      }
    } else if (action === AndroidActionType.SetUpBuildCredentialsFromCredentialsJson) {
      await new SetUpBuildCredentialsFromCredentialsJson(appLookupParams).runAsync(ctx);
    } else if (action === AndroidActionType.SetUpBuildCredentials) {
      await new SetUpBuildCredentials({ app: appLookupParams }).runAsync(ctx);
    }
  }
}
