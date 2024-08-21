import { Platform } from '@expo/eas-build-job';
import { BuildProfile } from '@expo/eas-json';
import assert from 'assert';
import nullthrows from 'nullthrows';

import { ActionInfo, IosActionType, Scope } from './Actions';
import { Action, PressAnyKeyToContinue } from './HelperActions';
import {
  credentialsJsonActions,
  getAscApiKeyActions,
  getBuildCredentialsActions,
  getPushKeyActions,
  highLevelActions,
} from './IosActions';
import { SelectBuildProfileFromEasJson } from './SelectBuildProfileFromEasJson';
import { SelectIosDistributionTypeGraphqlFromBuildProfile } from './SelectIosDistributionTypeGraphqlFromBuildProfile';
import {
  AccountFragment,
  AppleDistributionCertificateFragment,
  IosAppBuildCredentialsFragment,
  IosDistributionType as IosDistributionTypeGraphql,
} from '../../graphql/generated';
import Log, { learnMore } from '../../log';
import { resolveXcodeBuildContextAsync } from '../../project/ios/scheme';
import { resolveTargetsAsync } from '../../project/ios/target';
import { getOwnerAccountForProjectIdAsync } from '../../project/projectUtils';
import { confirmAsync, promptAsync, selectAsync } from '../../prompts';
import { ensureActorHasPrimaryAccount } from '../../user/actions';
import { CredentialsContext, CredentialsContextProjectInfo } from '../context';
import {
  AppStoreApiKeyPurpose,
  selectAscApiKeysFromAccountAsync,
} from '../ios/actions/AscApiKeyUtils';
import { AssignAscApiKey } from '../ios/actions/AssignAscApiKey';
import { AssignPushKey } from '../ios/actions/AssignPushKey';
import { getAppLookupParamsFromContextAsync } from '../ios/actions/BuildCredentialsUtils';
import { CreateAscApiKey } from '../ios/actions/CreateAscApiKey';
import { CreateDistributionCertificate } from '../ios/actions/CreateDistributionCertificate';
import { CreatePushKey } from '../ios/actions/CreatePushKey';
import { selectValidDistributionCertificateAsync } from '../ios/actions/DistributionCertificateUtils';
import { selectPushKeyAsync } from '../ios/actions/PushKeyUtils';
import { SelectAndRemoveAscApiKey } from '../ios/actions/RemoveAscApiKey';
import { SelectAndRemoveDistributionCertificate } from '../ios/actions/RemoveDistributionCertificate';
import { RemoveProvisioningProfiles } from '../ios/actions/RemoveProvisioningProfile';
import { SelectAndRemovePushKey } from '../ios/actions/RemovePushKey';
import { SetUpAdhocProvisioningProfile } from '../ios/actions/SetUpAdhocProvisioningProfile';
import { SetUpAscApiKey } from '../ios/actions/SetUpAscApiKey';
import { SetUpBuildCredentials } from '../ios/actions/SetUpBuildCredentials';
import { SetUpBuildCredentialsFromCredentialsJson } from '../ios/actions/SetUpBuildCredentialsFromCredentialsJson';
import { SetUpProvisioningProfile } from '../ios/actions/SetUpProvisioningProfile';
import { SetUpPushKey } from '../ios/actions/SetUpPushKey';
import { UpdateCredentialsJson } from '../ios/actions/UpdateCredentialsJson';
import { AppLookupParams } from '../ios/api/graphql/types/AppLookupParams';
import { App, IosAppCredentialsMap, Target } from '../ios/types';
import { displayIosCredentials } from '../ios/utils/printCredentials';

export class ManageIos {
  constructor(
    protected callingAction: Action,
    protected projectDir: string
  ) {}

  async runAsync(currentActions: ActionInfo[] = highLevelActions): Promise<void> {
    const buildProfile = this.callingAction.projectInfo
      ? await new SelectBuildProfileFromEasJson(this.projectDir, Platform.IOS).runAsync()
      : null;

    let projectInfo: CredentialsContextProjectInfo | null = null;
    if (this.callingAction.projectInfo) {
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
    const buildCredentialsActions = getBuildCredentialsActions(ctx);
    const pushKeyActions = getPushKeyActions(ctx);
    const ascApiKeyActions = getAscApiKeyActions(ctx);

    await ctx.bestEffortAppStoreAuthenticateAsync();

    const getAccountForProjectAsync = async (projectId: string): Promise<AccountFragment> => {
      return await getOwnerAccountForProjectIdAsync(ctx.graphqlClient, projectId);
    };

    const account = ctx.hasProjectContext
      ? await getAccountForProjectAsync(ctx.projectId)
      : ensureActorHasPrimaryAccount(ctx.user);

    let app = null;
    let targets = null;
    if (ctx.hasProjectContext) {
      assert(buildProfile, 'buildProfile must be defined in project context');
      const projectContext = await this.createProjectContextAsync(ctx, account, buildProfile);
      app = projectContext.app;
      targets = projectContext.targets;
    }

    while (true) {
      try {
        if (ctx.hasProjectContext) {
          assert(targets && app);
          const iosAppCredentialsMap: IosAppCredentialsMap = {};
          for (const target of targets) {
            const appLookupParams = await getAppLookupParamsFromContextAsync(ctx, target);
            iosAppCredentialsMap[target.targetName] =
              await ctx.ios.getIosAppCredentialsWithCommonFieldsAsync(
                ctx.graphqlClient,
                appLookupParams
              );
          }
          displayIosCredentials(app, iosAppCredentialsMap, targets);
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
          if (chosenAction === IosActionType.ManageBuildCredentials) {
            currentActions = buildCredentialsActions;
            continue;
          } else if (chosenAction === IosActionType.ManageCredentialsJson) {
            currentActions = credentialsJsonActions;
            continue;
          } else if (chosenAction === IosActionType.ManagePushKey) {
            currentActions = pushKeyActions;
            continue;
          } else if (chosenAction === IosActionType.ManageAscApiKey) {
            currentActions = ascApiKeyActions;
            continue;
          } else if (chosenAction === IosActionType.GoBackToHighLevelActions) {
            currentActions = highLevelActions;
            continue;
          } else if (chosenAction === IosActionType.GoBackToCaller) {
            await this.callingAction.runAsync(ctx);
            return;
          }
        } else if (actionInfo.scope === Scope.Project) {
          assert(
            ctx.hasProjectContext,
            'You must be in your project directory in order to perform this action'
          );
          await this.runProjectSpecificActionAsync(
            ctx,
            nullthrows(app, 'app must be defined in project context'),
            nullthrows(targets, 'targets must be defined in project context'),
            nullthrows(buildProfile, 'buildProfile must be defined in project context'),
            chosenAction
          );
        } else if (actionInfo.scope === Scope.Account) {
          await this.runAccountSpecificActionAsync(ctx, account, chosenAction);
        } else {
          throw new Error('Unknown action selected');
        }
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

  protected async createProjectContextAsync(
    ctx: CredentialsContext,
    account: AccountFragment,
    buildProfile: BuildProfile<Platform.IOS>
  ): Promise<{
    app: App;
    targets: Target[];
  }> {
    assert(ctx.hasProjectContext, 'createProjectContextAsync: must have project context.');

    const app = { account, projectName: ctx.exp.slug };
    const xcodeBuildContext = await resolveXcodeBuildContextAsync(
      {
        projectDir: ctx.projectDir,
        nonInteractive: ctx.nonInteractive,
        exp: ctx.exp,
        vcsClient: ctx.vcsClient,
      },
      buildProfile
    );
    const targets = await resolveTargetsAsync({
      exp: ctx.exp,
      projectDir: ctx.projectDir,
      xcodeBuildContext,
      env: buildProfile.env,
      vcsClient: ctx.vcsClient,
    });
    return {
      app,
      targets,
    };
  }

  protected async runAccountSpecificActionAsync(
    ctx: CredentialsContext,
    account: AccountFragment,
    action: IosActionType
  ): Promise<void> {
    if (action === IosActionType.RemoveDistributionCertificate) {
      await new SelectAndRemoveDistributionCertificate(account).runAsync(ctx);
    } else if (action === IosActionType.CreateDistributionCertificate) {
      await new CreateDistributionCertificate(account).runAsync(ctx);
    } else if (action === IosActionType.CreatePushKey) {
      await new CreatePushKey(account).runAsync(ctx);
    } else if (action === IosActionType.CreateAscApiKeyForSubmissions) {
      await new CreateAscApiKey(account).runAsync(ctx, AppStoreApiKeyPurpose.SUBMISSION_SERVICE);
    } else if (action === IosActionType.RemovePushKey) {
      await new SelectAndRemovePushKey(account).runAsync(ctx);
    } else if (action === IosActionType.RemoveAscApiKey) {
      await new SelectAndRemoveAscApiKey(account).runAsync(ctx);
    }
  }

  protected async runProjectSpecificActionAsync(
    ctx: CredentialsContext,
    app: App,
    targets: Target[],
    buildProfile: BuildProfile<Platform.IOS>,
    action: IosActionType
  ): Promise<void> {
    if (action === IosActionType.SetUpBuildCredentials) {
      await new SetUpBuildCredentials({
        app,
        targets,
        distribution: buildProfile.distribution,
        enterpriseProvisioning: buildProfile.enterpriseProvisioning,
      }).runAsync(ctx);
      return;
    }

    const distributionType = await new SelectIosDistributionTypeGraphqlFromBuildProfile(
      buildProfile
    ).runAsync(ctx);

    if (action === IosActionType.SetUpBuildCredentialsFromCredentialsJson) {
      await new SetUpBuildCredentialsFromCredentialsJson(app, targets, distributionType).runAsync(
        ctx
      );
      return;
    } else if (action === IosActionType.UpdateCredentialsJson) {
      await new UpdateCredentialsJson(app, targets, distributionType).runAsync(ctx);
      return;
    }

    const target = await this.selectTargetAsync(targets);
    const appLookupParams = await getAppLookupParamsFromContextAsync(ctx, target);
    switch (action) {
      case IosActionType.UseExistingDistributionCertificate: {
        const distCert = await selectValidDistributionCertificateAsync(ctx, appLookupParams);
        if (!distCert) {
          return;
        }
        await this.setupProvisioningProfileWithSpecificDistCertAsync(
          ctx,
          target,
          appLookupParams,
          distCert,
          distributionType
        );
        return;
      }
      case IosActionType.CreateDistributionCertificate: {
        const distCert = await new CreateDistributionCertificate(appLookupParams.account).runAsync(
          ctx
        );
        const confirm = await confirmAsync({
          message: `Do you want ${appLookupParams.projectName} to use the new Distribution Certificate?`,
        });
        if (confirm) {
          await this.setupProvisioningProfileWithSpecificDistCertAsync(
            ctx,
            target,
            appLookupParams,
            distCert,
            distributionType
          );
        }
        return;
      }
      case IosActionType.RemoveProvisioningProfile: {
        const iosAppCredentials = await ctx.ios.getIosAppCredentialsWithCommonFieldsAsync(
          ctx.graphqlClient,
          appLookupParams
        );
        const provisioningProfile = iosAppCredentials?.iosAppBuildCredentialsList.find(
          buildCredentials => buildCredentials.iosDistributionType === distributionType
        )?.provisioningProfile;
        if (!provisioningProfile) {
          Log.log(
            `No provisioning profile associated with the ${distributionType} configuration of ${appLookupParams.projectName}`
          );
          return;
        }
        const confirm = await confirmAsync({
          message: `Delete the provisioning profile associated with the ${distributionType} configuration of ${appLookupParams.projectName}?`,
        });
        if (confirm) {
          await new RemoveProvisioningProfiles([appLookupParams], [provisioningProfile]).runAsync(
            ctx
          );
        }
        return;
      }
      case IosActionType.SetUpPushKey: {
        const setupPushKeyAction = await new SetUpPushKey(appLookupParams);
        const isPushKeySetup = await setupPushKeyAction.isPushKeySetupAsync(ctx);
        if (isPushKeySetup) {
          Log.log(
            `Push Key is already set up for ${appLookupParams.projectName} ${appLookupParams.bundleIdentifier}`
          );
        } else {
          await new SetUpPushKey(appLookupParams).runAsync(ctx);
        }
        return;
      }
      case IosActionType.CreatePushKey: {
        const pushKey = await new CreatePushKey(appLookupParams.account).runAsync(ctx);
        const confirm = await confirmAsync({
          message: `Do you want ${appLookupParams.projectName} to use the new Push Key?`,
        });
        if (confirm) {
          await new AssignPushKey(appLookupParams).runAsync(ctx, pushKey);
        }
        return;
      }
      case IosActionType.UseExistingPushKey: {
        const selectedPushKey = await selectPushKeyAsync(ctx, appLookupParams.account);
        if (selectedPushKey) {
          await new AssignPushKey(appLookupParams).runAsync(ctx, selectedPushKey);
        }
        return;
      }
      case IosActionType.SetUpAscApiKeyForSubmissions: {
        await new SetUpAscApiKey(
          appLookupParams,
          AppStoreApiKeyPurpose.SUBMISSION_SERVICE
        ).runAsync(ctx);
        return;
      }
      case IosActionType.UseExistingAscApiKeyForSubmissions: {
        const ascApiKey = await selectAscApiKeysFromAccountAsync(ctx, appLookupParams.account, {
          filterDifferentAppleTeam: true,
        });
        if (ascApiKey) {
          await new AssignAscApiKey(appLookupParams).runAsync(
            ctx,
            ascApiKey,
            AppStoreApiKeyPurpose.SUBMISSION_SERVICE
          );
        }
        return;
      }
      case IosActionType.CreateAscApiKeyForSubmissions: {
        const ascApiKey = await new CreateAscApiKey(appLookupParams.account).runAsync(
          ctx,
          AppStoreApiKeyPurpose.SUBMISSION_SERVICE
        );
        const confirm = await confirmAsync({
          message: `Do you want ${appLookupParams.projectName} to use the new API Key?`,
        });
        if (confirm) {
          await new AssignAscApiKey(appLookupParams).runAsync(
            ctx,
            ascApiKey,
            AppStoreApiKeyPurpose.SUBMISSION_SERVICE
          );
        }
        return;
      }
      default:
        throw new Error('Unknown action selected');
    }
  }

  protected async setupProvisioningProfileWithSpecificDistCertAsync(
    ctx: CredentialsContext,
    target: Target,
    appLookupParams: AppLookupParams,
    distCert: AppleDistributionCertificateFragment,
    distributionType: IosDistributionTypeGraphql
  ): Promise<IosAppBuildCredentialsFragment> {
    Log.log(`Setting up ${appLookupParams.projectName} to use Distribution Certificate`);
    Log.log(`Creating provisioning profile...`);
    if (distributionType === IosDistributionTypeGraphql.AdHoc) {
      return await new SetUpAdhocProvisioningProfile({
        app: appLookupParams,
        target,
      }).runWithDistributionCertificateAsync(ctx, distCert);
    } else {
      return await new SetUpProvisioningProfile(
        appLookupParams,
        target,
        distributionType
      ).createAndAssignProfileAsync(ctx, distCert);
    }
  }

  protected async selectTargetAsync(targets: Target[]): Promise<Target> {
    if (targets.length === 1) {
      return targets[0];
    }
    return await selectAsync<Target>(
      'Which target do you want to use?',
      targets.map(target => ({
        title: `${target.targetName} (Bundle Identifier: ${target.bundleIdentifier})`,
        value: target,
      }))
    );
  }
}
