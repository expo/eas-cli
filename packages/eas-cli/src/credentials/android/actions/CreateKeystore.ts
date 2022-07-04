import { AndroidKeystoreFragment } from '../../../graphql/generated.js';
import Log from '../../../log.js';
import { getProjectIdAsync } from '../../../project/projectUtils.js';
import { Account } from '../../../user/Account.js';
import { CredentialsContext } from '../../context.js';
import { askForUserProvidedAsync } from '../../utils/promptForCredentials.js';
import { KeystoreWithType, keystoreSchema } from '../credentials.js';
import { generateRandomKeystoreAsync } from '../utils/keystore.js';
import { getKeystoreWithType, validateKeystore } from '../utils/keystoreNew.js';

export class CreateKeystore {
  constructor(private account: Account) {}

  public async runAsync(ctx: CredentialsContext): Promise<AndroidKeystoreFragment> {
    if (ctx.nonInteractive) {
      throw new Error(`New keystore cannot be created in non-interactive mode.`);
    }

    const projectId = await getProjectIdAsync(ctx.exp);
    const keystore = await this.provideOrGenerateAsync(projectId);
    const keystoreFragment = await ctx.android.createKeystoreAsync(this.account, keystore);
    Log.succeed('Created keystore');
    return keystoreFragment;
  }

  private async provideOrGenerateAsync(projectId: string): Promise<KeystoreWithType> {
    const providedKeystore = await askForUserProvidedAsync(keystoreSchema);
    if (providedKeystore) {
      const providedKeystoreWithType = getKeystoreWithType(providedKeystore);
      validateKeystore(providedKeystoreWithType);
      return providedKeystoreWithType;
    }
    return await generateRandomKeystoreAsync(projectId);
  }
}
