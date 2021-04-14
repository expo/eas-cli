import { Command } from '@oclif/command';

import { createCredentialsContextAsync } from '../credentials/context';
import { SetupBuildCredentialsFromCredentialsJson } from '../credentials/ios/actions/new/SetupBuildCredentialsFromCredentialsJson';
import { ManageIosBeta } from '../credentials/manager/ManageIosBeta';
import { IosDistributionType } from '../graphql/generated';

export default class ilovecats extends Command {
  static description = 'i love cats!';

  async run() {
    const ctx = await createCredentialsContextAsync(process.cwd(), {});
    const app = ManageIosBeta.getAppLookupParamsFromContext(ctx);
    //await ctx.appStore.ensureAuthenticatedAsync();
    const someAction = new SetupBuildCredentialsFromCredentialsJson(
      app,
      IosDistributionType.AppStore
    );
    await someAction.runAsync(ctx);

    //console.log('DEBUG build credentials ', buildCredentials);
  }
}
