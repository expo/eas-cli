import { IosDistributionType as IosDistributionTypeGraphql } from '../../../../graphql/generated';
import Log from '../../../../log';
import { Context } from '../../../context';
import { updateIosCredentialsAsync } from '../../../credentialsJson/update';
import { AppLookupParams } from '../../api/GraphqlClient';

export class UpdateCredentialsJson {
  constructor(
    private app: AppLookupParams,
    private iosDistributionTypeGraphql: IosDistributionTypeGraphql
  ) {}

  async runAsync(ctx: Context): Promise<void> {
    Log.log('Updating iOS credentials in credentials.json');
    await updateIosCredentialsAsync(ctx, this.app, this.iosDistributionTypeGraphql);
    Log.succeed(
      'iOS part of your local credentials.json is synced with values stored on EAS servers.'
    );
  }
}
