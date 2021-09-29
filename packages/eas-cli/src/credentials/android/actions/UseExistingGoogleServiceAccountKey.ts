import chalk from 'chalk';

import { GoogleServiceAccountKeyFragment } from '../../../graphql/generated';
import Log from '../../../log';
import { promptAsync } from '../../../prompts';
import { Account } from '../../../user/Account';
import { fromNow } from '../../../utils/date';
import { CredentialsContext } from '../../context';

export class UseExistingGoogleServiceAccountKey {
  constructor(private account: Account) {}

  public async runAsync(ctx: CredentialsContext): Promise<GoogleServiceAccountKeyFragment | null> {
    if (ctx.nonInteractive) {
      throw new Error(
        `Existing Google Service Account Key cannot be chosen in non-interactive mode.`
      );
    }
    const gsaKeyFragments = await ctx.android.getGoogleServiceAccountKeysForAccountAsync(
      this.account
    );
    if (gsaKeyFragments.length === 0) {
      Log.error("There aren't any Google Service Account Keys associated with your account.");
      return null;
    }
    return await this.selectGoogleServiceAccountKeyAsync(gsaKeyFragments);
  }

  private async selectGoogleServiceAccountKeyAsync(
    keys: GoogleServiceAccountKeyFragment[]
  ): Promise<GoogleServiceAccountKeyFragment | null> {
    const sortedKeys = this.sortGoogleServiceAccountKeysByUpdatedAtDesc(keys);
    const { chosenKey } = await promptAsync({
      type: 'select',
      name: 'chosenKey',
      message: 'Select a Google Service Account Key:',
      choices: sortedKeys.map(key => ({
        title: this.formatGoogleServiceAccountKey(key),
        value: key,
      })),
    });
    return chosenKey;
  }

  private sortGoogleServiceAccountKeysByUpdatedAtDesc(
    keys: GoogleServiceAccountKeyFragment[]
  ): GoogleServiceAccountKeyFragment[] {
    return keys.sort(
      (keyA, keyB) =>
        new Date(keyB.updatedAt).getMilliseconds() - new Date(keyA.updatedAt).getMilliseconds()
    );
  }

  private formatGoogleServiceAccountKey({
    projectIdentifier,
    privateKeyIdentifier,
    clientEmail,
    clientIdentifier,
    updatedAt,
  }: GoogleServiceAccountKeyFragment): string {
    let line: string = '';
    line += `Client Email: ${clientEmail}, Project Id: ${projectIdentifier}`;
    line += chalk.gray(
      `\n    Client Id: ${clientIdentifier}, Private Key Id: ${privateKeyIdentifier}`
    );
    line += chalk.gray(`\n    Updated: ${fromNow(new Date(updatedAt))} ago,`);
    return line;
  }
}
