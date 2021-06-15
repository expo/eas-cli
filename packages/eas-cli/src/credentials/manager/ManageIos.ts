import { EasJsonReader, IosBuildProfile } from '@expo/eas-json';
import assert from 'assert';
import nullthrows from 'nullthrows';

import {
  AppleDistributionCertificateFragment,
  IosAppBuildCredentialsFragment,
  IosDistributionType as IosDistributionTypeGraphql,
} from '../../graphql/generated';
import Log from '../../log';
import { resolveXcodeBuildContextAsync } from '../../project/ios/scheme';
import { resolveTargetsAsync } from '../../project/ios/target';
import { getProjectAccountName } from '../../project/projectUtils';
import { confirmAsync, promptAsync, selectAsync } from '../../prompts';
import { Account, findAccountByName } from '../../user/Account';
import { ensureActorHasUsername } from '../../user/actions';
import { Action, Context } from '../context';
import { getAppLookupParamsFromContext } from '../ios/actions/BuildCredentialsUtils';
import { CreateDistributionCertificate } from '../ios/actions/CreateDistributionCertificate';
import { selectValidDistributionCertificateAsync } from '../ios/actions/DistributionCertificateUtils';
import { SelectAndRemoveDistributionCertificate } from '../ios/actions/RemoveDistributionCertificate';
import { RemoveProvisioningProfiles } from '../ios/actions/RemoveProvisioningProfile';
import { SetupAdhocProvisioningProfile } from '../ios/actions/SetupAdhocProvisioningProfile';
import { SetupBuildCredentials } from '../ios/actions/SetupBuildCredentials';
import { SetupBuildCredentialsFromCredentialsJson } from '../ios/actions/SetupBuildCredentialsFromCredentialsJson';
import { SetupProvisioningProfile } from '../ios/actions/SetupProvisioningProfile';
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
  GoBackToCaller,
  GoBackToHighLevelActions,
  SetupBuildCredentials,
  SetupBuildCredentialsFromCredentialsJson,
  UpdateCredentialsJson,
  UseExistingDistributionCertificate,
  RemoveProvisioningProfile,
  CreateDistributionCertificate,
  RemoveDistributionCertificate,
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
            iosAppCredentialsMap[
              target.targetName
            ] = await ctx.ios.getIosAppCredentialsWithCommonFieldsAsync(appLookupParams);
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
          } else if (chosenAction === ActionType.GoBackToHighLevelActions) {
            currentActions = highLevelActions;
            continue;
          } else if (chosenAction === ActionType.GoBackToCaller) {
            return await this.callingAction.runAsync(ctx);
          }
        } else if (actionInfo.scope === Scope.Project) {
          await this.runProjectSpecificActionAsync(
            ctx,
            nullthrows(app),
            nullthrows(targets),
            nullthrows(buildProfile),
            chosenAction
          );
        } else if (actionInfo.scope === Scope.Account) {
          await this.runAccountSpecificActionAsync(ctx, account, chosenAction);
        } else {
          throw new Error('Unknown action selected');
        }
      } catch (err) {
        Log.error(err);
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

    const app = { account, projectName: ctx.exp.slug };
    const easJsonReader = new EasJsonReader(ctx.projectDir, 'ios');
    const easConfig = await new SelectBuildProfileFromEasJson(easJsonReader).runAsync(ctx);
    const buildProfile = nullthrows(easConfig.builds.ios, 'iOS build profile must be defined');
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
