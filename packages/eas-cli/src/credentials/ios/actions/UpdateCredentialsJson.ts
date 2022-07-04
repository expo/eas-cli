import { IosDistributionType } from '../../../graphql/generated.js';
import Log from '../../../log.js';
import { CredentialsContext } from '../../context.js';
import { updateIosCredentialsAsync } from '../../credentialsJson/update.js';
import { App, Target } from '../types.js';

export class UpdateCredentialsJson {
  constructor(
    private app: App,
    private targets: Target[],
    private distributionType: IosDistributionType
  ) {}

  async runAsync(ctx: CredentialsContext): Promise<void> {
    Log.log('Updating iOS credentials in credentials.json');
    await updateIosCredentialsAsync(ctx, this.app, this.targets, this.distributionType);
    Log.succeed(
      'iOS part of your local credentials.json is synced with values stored on EAS servers.'
    );
  }
}
