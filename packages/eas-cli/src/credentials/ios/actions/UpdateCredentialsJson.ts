import { IosDistributionType } from '../../../graphql/generated';
import Log from '../../../log';
import { CredentialsContext } from '../../context';
import { updateIosCredentialsAsync } from '../../credentialsJson/update';
import { App, Target } from '../types';

export class UpdateCredentialsJson {
  constructor(
    private readonly app: App,
    private readonly targets: Target[],
    private readonly distributionType: IosDistributionType
  ) {}

  async runAsync(ctx: CredentialsContext): Promise<void> {
    Log.log('Updating iOS credentials in credentials.json');
    await updateIosCredentialsAsync(ctx, this.app, this.targets, this.distributionType);
    Log.succeed(
      'iOS part of your local credentials.json is synced with values stored on EAS servers.'
    );
  }
}
