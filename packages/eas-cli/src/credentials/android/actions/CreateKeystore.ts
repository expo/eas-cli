import { AndroidKeystoreFragment } from '../../../graphql/generated';
import Log from '../../../log';
import { Account } from '../../../user/Account';
import { Context } from '../../context';
import { askForUserProvidedAsync } from '../../utils/promptForCredentials';
import { KeystoreWithType, keystoreSchema } from '../credentials';
import { generateRandomKeystoreAsync } from '../utils/keystore';
import { getKeystoreWithType, validateKeystore } from '../utils/keystoreNew';

export class CreateKeystore {
  constructor(private account: Account) {}

  public async runAsync(ctx: Context): Promise<AndroidKeystoreFragment> {
    if (ctx.nonInteractive) {
      throw new Error(`New keystore cannot be created in non-interactive mode.`);
    }
    const keystore = await this.provideOrGenerateAsync();
    const keystoreFragment = await ctx.android.createKeystoreAsync(this.account, keystore);
    Log.succeed('Created keystore');
    return keystoreFragment;
  }

  private async provideOrGenerateAsync(): Promise<KeystoreWithType> {
    const providedKeystore = await askForUserProvidedAsync(keystoreSchema);
    if (providedKeystore) {
      const providedKeystoreWithType = getKeystoreWithType(providedKeystore);
      validateKeystore(providedKeystoreWithType);
      return providedKeystoreWithType;
    }
    return await generateRandomKeystoreAsync();
  }
}
