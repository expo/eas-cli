import { EasConfig, EasJsonReader } from '@expo/eas-json';

import {
  AppleDistributionCertificateFragment,
  IosAppBuildCredentialsFragment,
  IosDistributionType as IosDistributionTypeGraphql,
} from '../../graphql/generated';
import Log from '../../log';
import { getProjectAccountName } from '../../project/projectUtils';
import { confirmAsync, promptAsync } from '../../prompts';
import { Account, findAccountByName } from '../../user/Account';
import { ensureActorHasUsername } from '../../user/actions';
import { Action, CredentialsManager } from '../CredentialsManager';
import { Context } from '../context';
import { SetupBuildCredentials } from '../ios/actions/SetupBuildCredentials';
import { getAppLookupParamsFromContext } from '../ios/actions/new/BuildCredentialsUtils';
import { CreateDistributionCertificate } from '../ios/actions/new/CreateDistributionCertificate';
import { selectValidDistributionCertificateAsync } from '../ios/actions/new/DistributionCertificateUtils';
import { SelectAndRemoveDistributionCertificate } from '../ios/actions/new/RemoveDistributionCertificate';
import { SetupAdhocProvisioningProfile } from '../ios/actions/new/SetupAdhocProvisioningProfile';
import { SetupBuildCredentialsFromCredentialsJson } from '../ios/actions/new/SetupBuildCredentialsFromCredentialsJson';
import { SetupProvisioningProfile } from '../ios/actions/new/SetupProvisioningProfile';
import { UpdateCredentialsJson } from '../ios/actions/new/UpdateCredentialsJson';
import { AppLookupParams } from '../ios/api/GraphqlClient';
import {
  displayEmptyIosCredentials,
  displayIosAppCredentials,
} from '../ios/utils/printCredentialsBeta';
import { PressAnyKeyToContinue } from './HelperActions';
import { SelectBuildProfileFromEasJson } from './SelectBuildProfileFromEasJson';
import { SelectIosDistributionTypeGraphqlFromBuildProfile } from './SelectIosDistributionTypeGraphqlFromBuildProfile';

enum ActionType {
  ManageCredentialsJson,
  ManageBuildCredentials,
  GoBackToHighLevelActions,
  SetupBuildCredentials,
  SetupBuildCredentialsFromCredentialsJson,
  UpdateCredentialsJson,
  UseExistingDistributionCertificate,
  RemoveSpecificProvisioningProfile,
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
];

export class ManageIosBeta implements Action {
  async runAsync(
    manager: CredentialsManager,
    ctx: Context,
    currentActions: ActionInfo[] = highLevelActions
  ): Promise<void> {
    while (true) {
      try {
        await ctx.bestEffortAppStoreAuthenticateAsync();

        const accountName = ctx.hasProjectContext
          ? getProjectAccountName(ctx.exp, ctx.user)
          : ensureActorHasUsername(ctx.user);

        const account = findAccountByName(ctx.user.accounts, accountName);
        if (!account) {
          throw new Error(`You do not have access to account: ${accountName}`);
        }
        if (ctx.hasProjectContext) {
          const appLookupParams = getAppLookupParamsFromContext(ctx);
          const iosAppCredentials = await ctx.newIos.getIosAppCredentialsWithCommonFieldsAsync(
            appLookupParams
          );
          if (!iosAppCredentials) {
            displayEmptyIosCredentials(appLookupParams);
          } else {
            displayIosAppCredentials(iosAppCredentials);
          }
        }

        const credentialsJsonActions: { value: ActionType; title: string; scope: Scope }[] = [
          {
            value: ActionType.UpdateCredentialsJson,
            title: 'Download contents from EAS servers to credentials.json',
            scope: Scope.Project,
          },
          {
            value: ActionType.SetupBuildCredentialsFromCredentialsJson,
            title: 'Upload contents from credentials.json to EAS servers',
            scope: Scope.Project,
          },
          {
            value: ActionType.GoBackToHighLevelActions,
            title: 'Go back',
            scope: Scope.Manager,
          },
        ];
        const buildCredentialsActions: { value: ActionType; title: string; scope: Scope }[] = [
          {
            // This command will be triggered during build to ensure all credentials are ready
            // I'm leaving it here for now to simplify testing
            value: ActionType.SetupBuildCredentials,
            title: 'All: Setup all the required credentials to build your project',
            scope: Scope.Project,
          },
          {
            value: ActionType.UseExistingDistributionCertificate,
            title: 'Distribution Certificate: Use an existing one for your project',
            scope: Scope.Project,
          },
          {
            value: ActionType.CreateDistributionCertificate,
            title: `Distribution Certificate: Add a new one${
              ctx.hasProjectContext ? ' to your project' : ''
            }`,
            scope: ctx.hasProjectContext ? Scope.Project : Scope.Account,
          },
          {
            value: ActionType.RemoveDistributionCertificate,
            title: 'Distribution Certificate: Delete one from your account',
            scope: Scope.Account,
          },
          {
            value: ActionType.GoBackToHighLevelActions,
            title: 'Go back',
            scope: Scope.Manager,
          },
        ];
        const { action: chosenAction } = await promptAsync({
          type: 'select',
          name: 'action',
          message: 'What do you want to do?',
          choices: currentActions.map(action => ({
            value: action.value,
            title: action.title,
          })),
        });
        try {
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
            }
          } else if (actionInfo.scope === Scope.Project) {
            const appLookupParams = getAppLookupParamsFromContext(ctx);
            const easJsonReader = await new EasJsonReader(ctx.projectDir, 'ios');
            const easConfig = await new SelectBuildProfileFromEasJson(easJsonReader).runAsync(ctx);
            await this.runProjectSpecificActionAsync(
              manager,
              ctx,
              appLookupParams,
              easConfig,
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
        await manager.runActionAsync(new PressAnyKeyToContinue());
      } catch (err) {
        Log.error(err);
        await manager.runActionAsync(new PressAnyKeyToContinue());
      }
    }
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
    manager: CredentialsManager,
    ctx: Context,
    appLookupParams: AppLookupParams,
    easConfig: EasConfig,
    action: ActionType
  ): Promise<void> {
    if (action === ActionType.SetupBuildCredentials) {
      const iosDistributionTypeEasConfig = easConfig.builds.ios?.distribution;
      if (!iosDistributionTypeEasConfig) {
        throw new Error(`The distributionType field is required in your iOS build profile`);
      }
      await new SetupBuildCredentials({
        app: appLookupParams,
        distribution: iosDistributionTypeEasConfig,
      }).runAsync(manager, ctx);
      return;
    }

    const iosAppCredentials = await ctx.newIos.getIosAppCredentialsWithCommonFieldsAsync(
      appLookupParams
    );
    const iosDistributionTypeGraphql = await new SelectIosDistributionTypeGraphqlFromBuildProfile(
      easConfig
    ).runAsync(ctx, iosAppCredentials);
    switch (action) {
      case ActionType.SetupBuildCredentialsFromCredentialsJson: {
        await new SetupBuildCredentialsFromCredentialsJson(
          appLookupParams,
          iosDistributionTypeGraphql
        ).runAsync(ctx);
        return;
      }
      case ActionType.UpdateCredentialsJson: {
        await new UpdateCredentialsJson(appLookupParams, iosDistributionTypeGraphql).runAsync(ctx);
        return;
      }
      case ActionType.UseExistingDistributionCertificate: {
        const distCert = await selectValidDistributionCertificateAsync(ctx, appLookupParams);
        if (!distCert) {
          return;
        }
        await this.setupProvisioningProfileWithSpecificDistCertAsync(
          ctx,
          appLookupParams,
          distCert,
          iosDistributionTypeGraphql
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
            iosDistributionTypeGraphql
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
    iosDistributionTypeGraphql: IosDistributionTypeGraphql
  ): Promise<IosAppBuildCredentialsFragment> {
    Log.log(`Setting up ${appLookupParams.projectName} to use Distribution Certificate`);
    Log.log(`Creating provisioning profile...`);
    if (iosDistributionTypeGraphql === IosDistributionTypeGraphql.AdHoc) {
      return await new SetupAdhocProvisioningProfile(
        appLookupParams
      ).runWithDistributionCertificateAsync(ctx, distCert);
    } else {
      return await new SetupProvisioningProfile(
        appLookupParams,
        iosDistributionTypeGraphql
      ).createAndAssignProfileAsync(ctx, distCert);
    }
  }
}
