import ora from 'ora';

import log from '../../../log';
import { Action, CredentialsManager } from '../../CredentialsManager';
import { Context } from '../../context';
import { readAndroidCredentialsAsync } from '../../credentialsJson/read';
import { validateKeystoreAsync } from '../utils/keystore';
import { UpdateKeystore } from './UpdateKeystore';

export class SetupBuildCredentials implements Action {
  constructor(private projectFullName: string) {}

  async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    if (await ctx.android.fetchKeystoreAsync(this.projectFullName)) {
      return;
    }
    if (ctx.nonInteractive) {
      throw new Error('Generating a new Keystore is not supported in --non-interactive mode');
    }

    manager.pushNextAction(new UpdateKeystore(this.projectFullName));
  }
}

export class SetupBuildCredentialsFromCredentialsJson implements Action {
  constructor(
    private projectFullName: string,
    private options: { skipKeystoreValidation: boolean }
  ) {}

  async runAsync(manager: CredentialsManager, ctx: Context): Promise<void> {
    let localCredentials;
    try {
      localCredentials = await readAndroidCredentialsAsync(ctx.projectDir);
    } catch (error) {
      log.error(
        'Reading credentials from credentials.json failed. Make sure this file is correct and all credentials are present there.'
      );
      throw error;
    }
    if (!this.options.skipKeystoreValidation) {
      await validateKeystoreAsync(localCredentials.keystore);
    }
    await ctx.android.updateKeystoreAsync(this.projectFullName, localCredentials.keystore);
    ora('Keystore updated').succeed();
  }
}
