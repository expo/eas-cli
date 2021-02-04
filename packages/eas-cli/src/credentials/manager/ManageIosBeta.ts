import Log from '../../log';
import { getProjectAccountName, getProjectConfigDescription } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { findAccountByName } from '../../user/Account';
import { ensureActorHasUsername } from '../../user/actions';
import { Action, CredentialsManager } from '../CredentialsManager';
import { Context } from '../context';
//import { RemoveDistributionCertificateBeta } from '../ios/actions/RemoveDistributionCertificateBeta';
import { AppLookupParams } from '../ios/api/GraphqlClient';
import {
  displayEmptyIosCredentials,
  displayIosAppCredentials,
} from '../ios/utils/printCredentialsBeta';
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
          const appLookupParams = this.getAppLookupParamsFromContext(ctx);
          const iosAppCredentials = await ctx.newIos.getIosAppCredentialsWithBuildCredentialsAsync(
            appLookupParams
          );
          if (!iosAppCredentials) {
            displayEmptyIosCredentials(appLookupParams);
          } else {
            displayIosAppCredentials(iosAppCredentials);
          }
        }

        const projectSpecificActions: { value: ActionType; title: string }[] = ctx.hasProjectContext
          ? []
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
          await manager.runActionAsync(this.getAction(ctx, accountName, action));
        } catch (err) {
          Log.error(err);
        }
        await manager.runActionAsync(new PressAnyKeyToContinue());
      } catch (err) {
        Log.error(err);
        await manager.runActionAsync(new PressAnyKeyToContinue());
      } finally {
        // TODO remove finally block before committing!
        return;
      }
    }
  }

  private getAppLookupParamsFromContext(ctx: Context): AppLookupParams {
    ctx.ensureProjectContext();
    const projectName = ctx.exp.slug;
    const accountName = getProjectAccountName(ctx.exp, ctx.user);

    const account = findAccountByName(ctx.user.accounts, accountName);
    if (!account) {
      throw new Error(`You do not have access to account: ${accountName}`);
    }

    const bundleIdentifier = ctx.exp.ios?.bundleIdentifier;
    if (!bundleIdentifier) {
      throw new Error(
        `ios.bundleIdentifier needs to be defined in your ${getProjectConfigDescription(
          ctx.projectDir
        )} file`
      );
    }

    return { account, projectName, bundleIdentifier };
  }

  private getAction(ctx: Context, accountName: string, action: ActionType): Action {
    switch (action) {
      /*       case ActionType.RemoveDistributionCertificate:
        return new RemoveDistributionCertificateBeta(accountName); */
      default:
        throw new Error('Unknown action selected');
    }
  }
}
