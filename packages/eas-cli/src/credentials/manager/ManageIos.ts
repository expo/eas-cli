import { DistributionType } from '@expo/eas-json';

import { promptAsync } from '../../prompts';
import { Action, CredentialsManager } from '../CredentialsManager';
import { Context } from '../context';
import { CreateDistributionCertificateStandaloneManager } from '../ios/actions/CreateDistributionCertificate';
import { RemoveDistributionCertificate } from '../ios/actions/RemoveDistributionCertificate';
import { RemoveSpecificProvisioningProfile } from '../ios/actions/RemoveProvisioningProfile';
import {
  SetupBuildCredentials,
  SetupBuildCredentialsFromCredentialsJson,
} from '../ios/actions/SetupBuildCredentials';
import { UpdateCredentialsJson } from '../ios/actions/UpdateCredentialsJson';
import { UpdateDistributionCertificate } from '../ios/actions/UpdateDistributionCertificate';
import { UseExistingDistributionCertificate } from '../ios/actions/UseDistributionCertificate';
import { AppLookupParams } from '../ios/credentials';
import { displayAllIosCredentials } from '../ios/utils/printCredentials';
import { PressAnyKeyToContinue } from './HelperActions';

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

export class ManageIos implements Action {
  async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    manager.pushNextAction(this);
    await ctx.bestEffortAppStoreAuthenticateAsync();

    const accountName = (ctx.hasProjectContext ? ctx.exp.owner : undefined) ?? ctx.user.username;
    const iosCredentials = await ctx.ios.getAllCredentialsAsync(accountName);

    await displayAllIosCredentials(iosCredentials);

    const projectSpecificActions: { value: ActionType; title: string }[] = ctx.hasProjectContext
      ? [
          {
            // This command will be triggered during build to ensure all credentials are ready
            // I'm leaving it here for now to simplify testing
            value: ActionType.SetupBuildCredentials,
            title: 'Ensure all credentials for project are valid',
          },
          {
            value: ActionType.UpdateCredentialsJson,
            title: 'Update credentials.json with values from Expo servers',
          },
          {
            value: ActionType.SetupBuildCredentialsFromCredentialsJson,
            title: 'Update credentials on Expo servers with values from credentials.json',
          },
          {
            value: ActionType.UseExistingDistributionCertificate,
            title: 'Use existing Distribution Certificate in current project',
          },
          {
            value: ActionType.RemoveSpecificProvisioningProfile,
            title: 'Remove Provisioning Profile from current project',
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
          value: ActionType.CreateDistributionCertificate,
          title: 'Add new Distribution Certificate',
        },
        {
          value: ActionType.UpdateDistributionCertificate,
          title: 'Remove Distribution Certificate',
        },
        {
          value: ActionType.RemoveDistributionCertificate,
          title: 'Update Distribution Certificate',
        },
      ],
    });

    manager.pushNextAction(new PressAnyKeyToContinue());
    manager.pushNextAction(this.getAction(manager, ctx, accountName, action));
  }

  private getAppLookupParamsFromContext(ctx: Context): AppLookupParams {
    const projectName = ctx.exp.slug;
    const accountName = ctx.exp.owner || ctx.user.username;
    const bundleIdentifier = ctx.exp.ios?.bundleIdentifier;
    if (!bundleIdentifier) {
      throw new Error(`ios.bundleIdentifier needs to be defined`);
    }

    return { accountName, projectName, bundleIdentifier };
  }

  private getAction(
    manager: CredentialsManager,
    ctx: Context,
    accountName: string,
    action: ActionType
  ): Action {
    switch (action) {
      case ActionType.CreateDistributionCertificate:
        return new CreateDistributionCertificateStandaloneManager(accountName);
      case ActionType.UpdateDistributionCertificate:
        return new UpdateDistributionCertificate(accountName);
      case ActionType.RemoveDistributionCertificate:
        return new RemoveDistributionCertificate(accountName);
      case ActionType.UseExistingDistributionCertificate: {
        const app = this.getAppLookupParamsFromContext(ctx);
        return new UseExistingDistributionCertificate(app);
      }
      case ActionType.SetupBuildCredentials: {
        const app = this.getAppLookupParamsFromContext(ctx);
        return new SetupBuildCredentials(app, DistributionType.STORE);
      }
      case ActionType.RemoveSpecificProvisioningProfile: {
        const app = this.getAppLookupParamsFromContext(ctx);
        return new RemoveSpecificProvisioningProfile(app);
      }
      case ActionType.UpdateCredentialsJson: {
        const app = this.getAppLookupParamsFromContext(ctx);
        return new UpdateCredentialsJson(app);
      }
      case ActionType.SetupBuildCredentialsFromCredentialsJson: {
        const app = this.getAppLookupParamsFromContext(ctx);
        return new SetupBuildCredentialsFromCredentialsJson(app);
      }
      default:
        throw new Error('Unknown action selected');
    }
  }
}
