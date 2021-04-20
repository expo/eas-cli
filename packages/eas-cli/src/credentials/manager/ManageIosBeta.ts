import { EasConfig, EasJsonReader } from '@expo/eas-json';

import Log from '../../log';
import { getProjectAccountName } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { findAccountByName } from '../../user/Account';
import { ensureActorHasUsername } from '../../user/actions';
import { Action, CredentialsManager } from '../CredentialsManager';
import { Context } from '../context';
import { SetupBuildCredentials } from '../ios/actions/SetupBuildCredentials';
import { getAppLookupParamsFromContext } from '../ios/actions/new/BuildCredentialsUtils';
import { SelectAndRemoveDistributionCertificate } from '../ios/actions/new/RemoveDistributionCertificate';
import { SetupBuildCredentialsFromCredentialsJson } from '../ios/actions/new/SetupBuildCredentialsFromCredentialsJson';
import { AppLookupParams } from '../ios/api/GraphqlClient';
import {
  displayEmptyIosCredentials,
  displayIosAppCredentials,
} from '../ios/utils/printCredentialsBeta';
import { PressAnyKeyToContinue } from './HelperActions';
import { SelectEasConfigFromJson } from './SelectEasConfigFromJson';
import { SelectIosDistributionTypeGraphqlFromEasConfig } from './SelectIosDistributionTypeGraphqlFromEasConfig';

enum ActionType {
  SetupBuildCredentials,
  SetupBuildCredentialsFromCredentialsJson,
  UpdateCredentialsJson,
  UseExistingDistributionCertificate,
  RemoveSpecificProvisioningProfile,
  CreateDistributionCertificate,
  UpdateDistributionCertificate,
  RemoveDistributionCertificate,
}

export class ManageIosBeta implements Action {
  async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
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

        const projectSpecificActions: { value: ActionType; title: string }[] = ctx.hasProjectContext
          ? [
              {
                // This command will be triggered during build to ensure all credentials are ready
                // I'm leaving it here for now to simplify testing
                value: ActionType.SetupBuildCredentials,
                title: 'Ensure all credentials for project are valid',
              },
              {
                value: ActionType.SetupBuildCredentialsFromCredentialsJson,
                title: 'Update credentials on EAS servers with values from credentials.json',
              },
            ]
          : [];
        const { action } = await promptAsync({
          type: 'select',
          name: 'action',
          message: 'What do you want to do?',
          choices: [
            ...projectSpecificActions,
            {
              value: ActionType.RemoveDistributionCertificate,
              title: 'Remove Distribution Certificate',
            },
          ],
        });
        try {
          const isProjectSpecific = projectSpecificActions.find(
            actionItem => actionItem.value === action
          );
          if (isProjectSpecific) {
            const appLookupParams = getAppLookupParamsFromContext(ctx);
            const easJsonReader = await new EasJsonReader(ctx.projectDir, 'ios');
            const easConfig = await new SelectEasConfigFromJson(easJsonReader).runAsync();
            await this.runProjectSpecificActionAsync(
              manager,
              ctx,
              appLookupParams,
              easConfig,
              action
            );
          } else if (action === ActionType.RemoveDistributionCertificate) {
            await new SelectAndRemoveDistributionCertificate(account).runAsync(ctx);
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

  private async runProjectSpecificActionAsync(
    manager: CredentialsManager,
    ctx: Context,
    appLookupParams: AppLookupParams,
    easConfig: EasConfig,
    action: ActionType
  ): Promise<void> {
    switch (action) {
      case ActionType.SetupBuildCredentials: {
        const iosDistributionTypeEasConfig = easConfig.builds.ios?.distribution;
        if (!iosDistributionTypeEasConfig) {
          throw new Error(`The distributionType field is required in your iOS build profile`);
        }
        return await new SetupBuildCredentials({
          app: appLookupParams,
          distribution: iosDistributionTypeEasConfig,
        }).runAsync(manager, ctx);
      }
      case ActionType.SetupBuildCredentialsFromCredentialsJson: {
        const iosAppCredentials = await ctx.newIos.getIosAppCredentialsWithCommonFieldsAsync(
          appLookupParams
        );
        const iosDistributionTypeGraphql = await new SelectIosDistributionTypeGraphqlFromEasConfig(
          easConfig
        ).runAsync(ctx, iosAppCredentials);
        await new SetupBuildCredentialsFromCredentialsJson(
          appLookupParams,
          iosDistributionTypeGraphql
        ).runAsync(ctx);
        return;
      }
      default:
        throw new Error('Unknown action selected');
    }
  }
}
