import { Analytics } from '../../../analytics/AnalyticsManager';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { AccountFragment, AndroidKeystoreFragment } from '../../../graphql/generated';
import Log from '../../../log';
import { CredentialsContext } from '../../context';
import { askForUserProvidedAsync } from '../../utils/promptForCredentials';
import { KeystoreWithType, keystoreSchema } from '../credentials';
import { generateRandomKeystoreAsync } from '../utils/keystore';
import { getKeystoreWithType, validateKeystore } from '../utils/keystoreNew';

export class CreateKeystore {
  constructor(private readonly account: AccountFragment) {}

  public async runAsync(ctx: CredentialsContext): Promise<AndroidKeystoreFragment> {
    if (ctx.nonInteractive) {
      throw new Error(`New keystore cannot be created in non-interactive mode.`);
    }

    const projectId = ctx.projectId;
    const keystore = await this.provideOrGenerateAsync(ctx.graphqlClient, ctx.analytics, projectId);
    const keystoreFragment = await ctx.android.createKeystoreAsync(
      ctx.graphqlClient,
      this.account,
      keystore
    );
    Log.succeed('Created keystore');
    return keystoreFragment;
  }

  private async provideOrGenerateAsync(
    graphqlClient: ExpoGraphqlClient,
    analytics: Analytics,
    projectId: string
  ): Promise<KeystoreWithType> {
    const providedKeystore = await askForUserProvidedAsync(keystoreSchema);
    if (providedKeystore) {
      const providedKeystoreWithType = getKeystoreWithType(providedKeystore);
      validateKeystore(providedKeystoreWithType);
      return providedKeystoreWithType;
    }
    return await generateRandomKeystoreAsync(graphqlClient, analytics, projectId);
  }
}
