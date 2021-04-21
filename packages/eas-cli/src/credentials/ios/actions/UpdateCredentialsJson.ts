import { IosDistributionType } from '../../../graphql/generated';
import Log from '../../../log';
import { Action, CredentialsManager } from '../../CredentialsManager';
import { Context } from '../../context';
import { updateIosCredentialsAsync } from '../../credentialsJson/update';
import { AppLookupParams } from '../credentials';
import { getAppLookupParamsFromContext } from './new/BuildCredentialsUtils';

export class UpdateCredentialsJson implements Action {
  constructor(private app: AppLookupParams) {}

  async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    Log.log('Updating iOS credentials in credentials.json');
    const appLookupParamsGraphql = getAppLookupParamsFromContext(ctx);
    await updateIosCredentialsAsync(ctx, appLookupParamsGraphql, IosDistributionType.AppStore);
    Log.succeed(
      'iOS part of your local credentials.json is synced with values stored on EAS servers.'
    );
  }
}
