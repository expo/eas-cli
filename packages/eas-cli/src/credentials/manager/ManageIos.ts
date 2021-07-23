import { Platform } from '@expo/eas-build-job';
import { IosBuildProfile } from '@expo/eas-json';
import assert from 'assert';
import nullthrows from 'nullthrows';

import {
  AppleDistributionCertificateFragment,
  IosAppBuildCredentialsFragment,
  IosDistributionType as IosDistributionTypeGraphql,
} from '../../graphql/generated';
import Log, { learnMore } from '../../log';
import { resolveXcodeBuildContextAsync } from '../../project/ios/scheme';
import { resolveTargetsAsync } from '../../project/ios/target';
import {
  getProjectAccountName,
  promptToCreateProjectIfNotExistsAsync,
} from '../../project/projectUtils';
import { confirmAsync, promptAsync, selectAsync } from '../../prompts';
import { Account, findAccountByName } from '../../user/Account';
import { ensureActorHasUsername } from '../../user/actions';
import { Action, Context } from '../context';
import { AssignPushKey } from '../ios/actions/AssignPushKey';
import { getAppLookupParamsFromContext } from '../ios/actions/BuildCredentialsUtils';
import { CreateDistributionCertificate } from '../ios/actions/CreateDistributionCertificate';
import { CreatePushKey } from '../ios/actions/CreatePushKey';
import { selectValidDistributionCertificateAsync } from '../ios/actions/DistributionCertificateUtils';
import { selectPushKeyAsync } from '../ios/actions/PushKeyUtils';
import { SelectAndRemoveDistributionCertificate } from '../ios/actions/RemoveDistributionCertificate';
import { RemoveProvisioningProfiles } from '../ios/actions/RemoveProvisioningProfile';
import { SelectAndRemovePushKey } from '../ios/actions/RemovePushKey';
import { SetupAdhocProvisioningProfile } from '../ios/actions/SetupAdhocProvisioningProfile';
import { SetupBuildCredentials } from '../ios/actions/SetupBuildCredentials';
import { SetupBuildCredentialsFromCredentialsJson } from '../ios/actions/SetupBuildCredentialsFromCredentialsJson';
import { SetupProvisioningProfile } from '../ios/actions/SetupProvisioningProfile';
import { SetupPushKey } from '../ios/actions/SetupPushKey';
import { UpdateCredentialsJson } from '../ios/actions/UpdateCredentialsJson';
import { AppLookupParams } from '../ios/api/GraphqlClient';
import { getManagedEntitlementsJsonAsync } from '../ios/appstore/entitlements';
import { App, IosAppCredentialsMap, Target } from '../ios/types';
import { displayIosCredentials } from '../ios/utils/printCredentials';
import { PressAnyKeyToContinue } from './HelperActions';
import { SelectBuildProfileFromEasJson } from './SelectBuildProfileFromEasJson';
import { SelectIosDistributionTypeGraphqlFromBuildProfile } from './SelectIosDistributionTypeGraphqlFromBuildProfile';

enum ActionType {
  ManageCredentialsJson,
  ManageBuildCredentials,
  ManagePushKey,
  GoBackToCaller,
  GoBackToHighLevelActions,
  SetupBuildCredentials,
  SetupBuildCredentialsFromCredentialsJson,
  UpdateCredentialsJson,
  UseExistingDistributionCertificate,
  RemoveProvisioningProfile,
  CreateDistributionCertificate,
  RemoveDistributionCertificate,
  SetupPushKey,
  CreatePushKey,
  UseExistingPushKey,
  RemovePushKey,
}

enum Scope {
  Project,
  Account,
  Manager,
}

type ActionInfo = { value: ActionType; title: string; scope: Scope };

const highLevelActions: ActionInfo[] = [
  {
    value: ActionType.ManageBuildCredentials,
    title: 'Build Credentials: Manage everything needed to build your project',
    scope: Scope.Manager,
  },
  {
    value: ActionType.ManagePushKey,
    title: 'Push Notifications: Manage your Apple Push Notifications Key',
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

function getPushKeyActions(ctx: Context): ActionInfo[] {
  return [
    {
      value: ActionType.SetupPushKey,
      title: 'Setup your project to use Push Notifications',
      scope: Scope.Project,
    },
    {
      value: ActionType.CreatePushKey,
      title: 'Add a new push key',
      scope: ctx.hasProjectContext ? Scope.Project : Scope.Account,
    },
    {
      value: ActionType.UseExistingPushKey,
      title: 'Use an existing push key',
      scope: Scope.Project,
    },
    {
      value: ActionType.RemovePushKey,
      title: 'Remove a push key from your account',
      scope: Scope.Account,
    },
    {
      value: ActionType.GoBackToHighLevelActions,
      title: 'Go back',
      scope: Scope.Manager,
    },
  ];
}

function getBuildCredentialsActions(ctx: Context): ActionInfo[] {
  return [
    {
      // This command will be triggered during build to ensure all credentials are ready
      // I'm leaving it here for now to simplify testing
      value: ActionType.SetupBuildCredentials,
      title: 'All: Set up all the required credentials to build your project',
      scope: Scope.Project,
    },
    {
      value: ActionType.UseExistingDistributionCertificate,
      title: 'Distribution Certificate: Use an existing one for your project',
      scope: Scope.Project,
    },
    {
      value: ActionType.CreateDistributionCertificate,
      title: `Distribution Certificate: Add a new one to your account`,
      scope: ctx.hasProjectContext ? Scope.Project : Scope.Account,
    },
    {
      value: ActionType.RemoveDistributionCertificate,
      title: 'Distribution Certificate: Delete one from your account',
      scope: Scope.Account,
    },
    {
      value: ActionType.RemoveProvisioningProfile,
      title: 'Provisioning Profile: Delete one from your project',
      scope: Scope.Project,
    },
    {
      value: ActionType.GoBackToHighLevelActions,
      title: 'Go back',
      scope: Scope.Manager,
    },
  ];
}

export class ManageIos {
  constructor(private callingAction: Action) {}
  async runAsync(ctx: Context, currentActions: ActionInfo[] = highLevelActions): Promise<void> {
    const buildCredentialsActions = getBuildCredentialsActions(ctx);
    const pushKeyActions = getPushKeyActions(ctx);

    await ctx.bestEffortAppStoreAuthenticateAsync();

    const accountName = ctx.hasProjectContext
      ? getProjectAccountName(ctx.exp, ctx.user)
      : ensureActorHasUsername(ctx.user);

    const account = findAccountByName(ctx.user.accounts, accountName);
    if (!account) {
      throw new Error(`You do not have access to account: ${accountName}`);
    }
    const { app, targets, buildProfile } = await this.createProjectContextAsync(ctx, account);

    while (true) {
      try {
        if (ctx.hasProjectContext) {
          assert(targets && app);
          const iosAppCredentialsMap: IosAppCredentialsMap = {};
          for (const target of targets) {
            const appLookupParams = getAppLookupParamsFromContext(ctx, target);
            iosAppCredentialsMap[target.targetName] =
              await ctx.ios.getIosAppCredentialsWithCommonFieldsAsync(appLookupParams);
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
          if (chosenAction === ActionType.ManageBuildCredentials) {
            currentActions = buildCredentialsActions;
            continue;
          } else if (chosenAction === ActionType.ManageCredentialsJson) {
            currentActions = credentialsJsonActions;
            continue;
          } else if (chosenAction === ActionType.ManagePushKey) {
            currentActions = pushKeyActions;
            continue;
          } else if (chosenAction === ActionType.GoBackToHighLevelActions) {
            currentActions = highLevelActions;
            continue;
          } else if (chosenAction === ActionType.GoBackToCaller) {
            return await this.callingAction.runAsync(ctx);
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

  private async createProjectContextAsync(
    ctx: Context,
    account: Account
  ): Promise<{ app: App | null; targets: Target[] | null; buildProfile: IosBuildProfile | null }> {
    if (!ctx.hasProjectContext) {
      return {
        app: null,
        targets: null,
        buildProfile: null,
      };
    }

    const maybeProjectId = await promptToCreateProjectIfNotExistsAsync(ctx.exp);
    if (!maybeProjectId) {
      throw new Error(
        'Your project must be registered with EAS in order to use the credentials manager.'
      );
    }

    const app = { account, projectName: ctx.exp.slug };
    const buildProfile = (await new SelectBuildProfileFromEasJson(
      ctx.projectDir,
      Platform.IOS
    ).runAsync(ctx)) as IosBuildProfile;
    const xcodeBuildContext = await resolveXcodeBuildContextAsync(
      {
        projectDir: ctx.projectDir,
        nonInteractive: ctx.nonInteractive,
        exp: ctx.exp,
      },
      buildProfile
    );
    const targets = await resolveTargetsAsync(
      { exp: ctx.exp, projectDir: ctx.projectDir },
      xcodeBuildContext
    );
    return {
      app,
      targets,
      buildProfile,
    };
  }

  private async runAccountSpecificActionAsync(
    ctx: Context,
    account: Account,
    action: ActionType
  ): Promise<void> {
    if (action === ActionType.RemoveDistributionCertificate) {
      await new SelectAndRemoveDistributionCertificate(account).runAsync(ctx);
    } else if (action === ActionType.CreateDistributionCertificate) {
      await new CreateDistributionCertificate(account).runAsync(ctx);
    } else if (action === ActionType.CreatePushKey) {
      await new CreatePushKey(account).runAsync(ctx);
    } else if (action === ActionType.RemovePushKey) {
      await new SelectAndRemovePushKey(account).runAsync(ctx);
    }
  }

  private async runProjectSpecificActionAsync(
    ctx: Context,
    app: App,
    targets: Target[],
    buildProfile: IosBuildProfile,
    action: ActionType
  ): Promise<void> {
    if (action === ActionType.SetupBuildCredentials) {
      await new SetupBuildCredentials({
        app,
        targets,
        distribution: buildProfile.distribution,
        enterpriseProvisioning: buildProfile.enterpriseProvisioning,
        iosCapabilitiesOptions: {
          entitlements: await getManagedEntitlementsJsonAsync(ctx.projectDir),
        },
      }).runAsync(ctx);
      return;
    }

    const distributionType = await new SelectIosDistributionTypeGraphqlFromBuildProfile(
      buildProfile
    ).runAsync(ctx);

    if (action === ActionType.SetupBuildCredentialsFromCredentialsJson) {
      await new SetupBuildCredentialsFromCredentialsJson(app, targets, distributionType).runAsync(
        ctx
      );
      return;
    } else if (action === ActionType.UpdateCredentialsJson) {
      await new UpdateCredentialsJson(app, targets, distributionType).runAsync(ctx);
      return;
    }

    const target = await this.selectTargetAsync(targets);
    const appLookupParams = getAppLookupParamsFromContext(ctx, target);
    switch (action) {
      case ActionType.UseExistingDistributionCertificate: {
        const distCert = await selectValidDistributionCertificateAsync(ctx, appLookupParams);
        if (!distCert) {
          return;
        }
        await this.setupProvisioningProfileWithSpecificDistCertAsync(
          ctx,
          appLookupParams,
          distCert,
          distributionType
        );
        return;
      }
      case ActionType.CreateDistributionCertificate: {
        const distCert = await new CreateDistributionCertificate(appLookupParams.account).runAsync(
          ctx
        );
        const confirm = await confirmAsync({
          message: `Do you want ${appLookupParams.projectName} to use the new Distribution Certificate?`,
        });
        if (confirm) {
          await this.setupProvisioningProfileWithSpecificDistCertAsync(
            ctx,
            appLookupParams,
            distCert,
            distributionType
          );
        }
        return;
      }
      case ActionType.RemoveProvisioningProfile: {
        const iosAppCredentials = await ctx.ios.getIosAppCredentialsWithCommonFieldsAsync(
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
      case ActionType.SetupPushKey: {
        const setupPushKeyAction = await new SetupPushKey(appLookupParams);
        const isPushKeySetup = await setupPushKeyAction.isPushKeySetupAsync(ctx);
        if (isPushKeySetup) {
          Log.log(
            `Push Key is already set up for ${appLookupParams.projectName} ${appLookupParams.bundleIdentifier}`
          );
        } else {
          await new SetupPushKey(appLookupParams).runAsync(ctx);
        }
        return;
      }
      case ActionType.CreatePushKey: {
        const pushKey = await new CreatePushKey(appLookupParams.account).runAsync(ctx);
        const confirm = await confirmAsync({
          message: `Do you want ${appLookupParams.projectName} to use the new Push Key?`,
        });
        if (confirm) {
          await new AssignPushKey(appLookupParams).runAsync(ctx, pushKey);
        }
        return;
      }
      case ActionType.UseExistingPushKey: {
        const selectedPushKey = await selectPushKeyAsync(ctx, appLookupParams.account);
        if (selectedPushKey) {
          await new AssignPushKey(appLookupParams).runAsync(ctx, selectedPushKey);
        }
        return;
      }
      default:
        throw new Error('Unknown action selected');
    }
  }

  private async setupProvisioningProfileWithSpecificDistCertAsync(
    ctx: Context,
    appLookupParams: AppLookupParams,
    distCert: AppleDistributionCertificateFragment,
    distributionType: IosDistributionTypeGraphql
  ): Promise<IosAppBuildCredentialsFragment> {
    Log.log(`Setting up ${appLookupParams.projectName} to use Distribution Certificate`);
    Log.log(`Creating provisioning profile...`);
    if (distributionType === IosDistributionTypeGraphql.AdHoc) {
      return await new SetupAdhocProvisioningProfile(
        appLookupParams
      ).runWithDistributionCertificateAsync(ctx, distCert);
    } else {
      return await new SetupProvisioningProfile(
        appLookupParams,
        distributionType
      ).createAndAssignProfileAsync(ctx, distCert);
    }
  }

  private async selectTargetAsync(targets: Target[]): Promise<Target> {
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
