import { GoogleServiceAccountKeyFragment } from '../../../graphql/generated';
import Log from '../../../log';
import { promptAsync } from '../../../prompts';
import { Account } from '../../../user/Account';
import { CredentialsContext } from '../../context';
import { GoogleServiceAccountKey } from '../credentials';
import {
  detectGoogleServiceAccountKeyPathAsync,
  readAndValidateServiceAccountKey,
} from '../utils/googleServiceAccountKey';

export class CreateGoogleServiceAccountKey {
  constructor(private account: Account) {}

  public async runAsync(ctx: CredentialsContext): Promise<GoogleServiceAccountKeyFragment> {
    if (ctx.nonInteractive) {
      throw new Error(`New Google Service Account Key cannot be created in non-interactive mode.`);
    }
    const jsonKeyObject = await this.provideAsync(ctx);
    const gsaKeyFragment = await ctx.android.createGoogleServiceAccountKeyAsync(
      this.account,
      jsonKeyObject
    );
    Log.succeed('Uploaded Google Service Account Key.');
    return gsaKeyFragment;
  }

  private async provideAsync(ctx: CredentialsContext): Promise<GoogleServiceAccountKey> {
    try {
      const keyJsonPath = await this.provideKeyJsonPathAsync(ctx);
      return readAndValidateServiceAccountKey(keyJsonPath);
    } catch (e) {
      Log.error(e);
      return await this.provideAsync(ctx);
    }
  }

  private async provideKeyJsonPathAsync(ctx: CredentialsContext): Promise<string> {
    const detectedPath = await detectGoogleServiceAccountKeyPathAsync(ctx.projectDir);
    if (detectedPath) {
      return detectedPath;
    }

    const { keyJsonPath } = await promptAsync([
      {
        type: 'text',
        name: 'keyJsonPath',
        message: 'Path to Google Service Account Key JSON file:',
        validate: (value: string) => value.length > 0 || "Path can't be empty",
      },
    ]);
    return keyJsonPath;
  }
}
