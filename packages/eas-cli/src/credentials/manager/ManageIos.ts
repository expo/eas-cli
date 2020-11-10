import { promptAsync } from '../../prompts';
import { Action, CredentialsManager } from '../CredentialsManager';
import { Context } from '../context';
import { CreateDistributionCertificateStandaloneManager } from '../ios/actions/CreateDistributionCertificate';
import { RemoveDistributionCertificate } from '../ios/actions/RemoveDistributionCertificate';
import {
  RemoveProvisioningProfile,
  RemoveSpecificProvisioningProfile,
} from '../ios/actions/RemoveProvisioningProfile';
import { SetupBuildCredentials } from '../ios/actions/SetupBuildCredentials';
import { UpdateDistributionCertificate } from '../ios/actions/UpdateDistributionCertificate';
import { UseExistingDistributionCertificate } from '../ios/actions/UseDistributionCertificate';
import { AppLookupParams } from '../ios/credentials';
import { displayAllIosCredentials } from '../ios/utils/printCredentials';
import { PressAnyKeyToContinue } from './HelperActions';

export class ManageIos implements Action {
  async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    manager.pushNextAction(this);
    await ctx.bestEffortAppStoreAuthenticateAsync();

    const accountName = (ctx.hasProjectContext ? ctx.exp.owner : undefined) ?? ctx.user.username;
    const iosCredentials = await ctx.ios.getAllCredentialsAsync(accountName);

    await displayAllIosCredentials(iosCredentials);

    const projectSpecificActions: { value: string; title: string }[] = ctx.hasProjectContext
      ? [
          {
            // This command will be triggered durring build to ensure all credentials are ready
            // I'm leaving it here for now to simplify testing
            value: 'setup-build-credentials',
            title: 'Ensure all credentials are valid',
          },
          {
            value: 'use-existing-dist-ios',
            title: 'Use existing Distribution Certificate in current project',
          },
          {
            value: 'remove-provisioning-profile-current-project',
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
        { value: 'create-ios-dist', title: 'Add new Distribution Certificate' },
        { value: 'remove-ios-dist', title: 'Remove Distribution Certificate' },
        { value: 'update-ios-dist', title: 'Update Distribution Certificate' },
        {
          value: 'remove-provisioning-profile',
          title: 'Remove Provisioning Profile',
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
    action: string
  ): Action {
    switch (action) {
      case 'create-ios-dist':
        return new CreateDistributionCertificateStandaloneManager(accountName);
      case 'update-ios-dist':
        return new UpdateDistributionCertificate(accountName);
      case 'remove-ios-dist':
        return new RemoveDistributionCertificate(accountName);
      case 'remove-provisioning-profile':
        return new RemoveProvisioningProfile(accountName);
      case 'use-existing-dist-ios': {
        const app = this.getAppLookupParamsFromContext(ctx);
        return new UseExistingDistributionCertificate(app);
      }
      case 'setup-build-credentials': {
        const app = this.getAppLookupParamsFromContext(ctx);
        return new SetupBuildCredentials(app);
      }
      case 'remove-provisioning-profile-current-project': {
        const app = this.getAppLookupParamsFromContext(ctx);
        return new RemoveSpecificProvisioningProfile(app);
      }
      default:
        throw new Error('Unknown action selected');
    }
  }
}
