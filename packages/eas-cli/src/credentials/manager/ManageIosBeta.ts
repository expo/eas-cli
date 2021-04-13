import Log from '../../log';
import { getProjectAccountName } from '../../project/projectUtils';
import { promptAsync } from '../../prompts';
import { findAccountByName } from '../../user/Account';
import { ensureActorHasUsername } from '../../user/actions';
import { Action, CredentialsManager } from '../CredentialsManager';
import { Context } from '../context';
import { getAppLookupParamsFromContext } from '../ios/actions/new/BuildCredentialsUtils';
import { SelectAndRemoveDistributionCertificate } from '../ios/actions/new/RemoveDistributionCertificate';
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
          if (action === ActionType.RemoveDistributionCertificate) {
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
      } finally {
        // TODO remove finally block before committing!
        return;
      }
    }
  }
}
