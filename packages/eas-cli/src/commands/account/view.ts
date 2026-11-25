import { CombinedError } from '@urql/core';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import Log from '../../log';
import { getAccessToken } from '../../user/SessionManager';
import { Actor, getActorDisplayName } from '../../user/User';
import { logAccountPermissions } from '../../user/accountPermissions';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

function isBearerTokenRejected(error: Error): boolean {
  return (
    !!getAccessToken() &&
    error instanceof CombinedError &&
    !error.networkError &&
    error.graphQLErrors.length > 0 &&
    error.graphQLErrors.every(
      ({ originalError }) =>
        originalError &&
        typeof originalError === 'object' &&
        'code' in originalError &&
        originalError.code === 'AUTHENTICATION_ERROR'
    )
  );
}

export default class AccountView extends EasCommand {
  static override description = 'show the username you are logged in as';
  static override aliases = ['whoami'];

  static override flags = EasNonInteractiveAndJsonFlags;

  private json = false;

  // eslint-disable-next-line async-protect/async-suffix
  protected override async init(): Promise<void> {
    await super.init();
    const { flags } = await this.parse(AccountView);
    this.json = flags.json;
    if (this.json) {
      enableJsonOutput();
    }
  }

  protected override catch(error: Error): Promise<void> {
    if (this.json) {
      if (isBearerTokenRejected(error)) {
        printJsonOnlyOutput({ status: 'token-rejected' });
        process.exitCode = 1;
        return Promise.resolve();
      }
      printJsonOnlyOutput({ status: 'indeterminate' });
    }
    return super.catch(error);
  }

  async runAsync(actor: Actor | undefined): Promise<void> {
    if (this.json) {
      if (actor) {
        printJsonOnlyOutput({
          status: 'signed-in',
          actor: { id: actor.id, type: actor.__typename, displayName: getActorDisplayName(actor) },
          accounts: actor.accounts.map(({ name }) => ({ name })),
        });
      } else if (getAccessToken()) {
        throw new Error('The server returned no actor for EXPO_TOKEN.');
      } else {
        printJsonOnlyOutput({ status: 'signed-out' });
        process.exitCode = 1;
      }
      return;
    }
    if (actor) {
      const displayName = getActorDisplayName(actor);
      const loggedInAs = getAccessToken()
        ? `${displayName} (authenticated using EXPO_TOKEN)`
        : displayName;
      Log.log(chalk.green(loggedInAs));
      if ('email' in actor) {
        Log.log(actor.email);
      }

      const { hasLimitedAccount } = logAccountPermissions(actor);
      if (hasLimitedAccount) {
        Log.newLine();
        Log.log(
          `The permissions granted during authentication limit your access to some accounts. Run ${chalk.bold(
            'eas login'
          )} to change the permission grant.`
        );
      }
    } else {
      Log.warn('Not logged in');
      process.exit(1);
    }
  }
}
