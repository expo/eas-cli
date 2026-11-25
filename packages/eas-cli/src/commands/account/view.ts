import { Errors } from '@oclif/core';
import { CombinedError } from '@urql/core';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import { EasJsonOnlyFlag } from '../../commandUtils/flags';
import Log from '../../log';
import SessionManager from '../../user/SessionManager';
import { Actor, getActorDisplayName } from '../../user/User';
import { logAccountPermissions } from '../../user/accountPermissions';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class AccountView extends EasCommand {
  static override description = 'show the username you are logged in as';
  static override aliases = ['whoami'];

  static override flags = EasJsonOnlyFlag;

  private json = false;

  static override contextDefinition = {
    ...this.ContextOptions.SessionManagment,
  };

  protected override async resolveActorAsync(
    sessionManager: SessionManager
  ): Promise<Actor | undefined> {
    const { flags } = await this.parse(AccountView);
    this.json = flags.json;
    if (!this.json) {
      return super.resolveActorAsync(sessionManager);
    }
    enableJsonOutput();
    try {
      return await super.resolveActorAsync(sessionManager);
    } catch (error) {
      if (
        sessionManager.getAccessToken() &&
        error instanceof CombinedError &&
        !error.networkError &&
        error.graphQLErrors.some(e => e.message === 'The bearer token is invalid.')
      ) {
        printJsonOnlyOutput({ status: 'token-rejected' });
        this.exit(1);
      }
      printJsonOnlyOutput({ status: 'indeterminate' });
      throw error;
    }
  }

  protected override catch(error: Error): Promise<void> {
    if (error instanceof Errors.ExitError) {
      throw error;
    }
    return super.catch(error);
  }

  async runAsync(actor: Actor | undefined): Promise<void> {
    const { sessionManager } = await this.getContextAsync(AccountView, { nonInteractive: true });
    const accessToken = sessionManager.getAccessToken();
    if (actor) {
      const displayName = getActorDisplayName(actor);
      if (this.json) {
        printJsonOnlyOutput({
          status: 'signed-in',
          actor: { id: actor.id, type: actor.__typename, displayName },
          accounts: actor.accounts.map(({ name }) => ({ name })),
        });
        return;
      }
      const loggedInAs = accessToken
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
    } else if (this.json) {
      if (accessToken) {
        printJsonOnlyOutput({ status: 'indeterminate' });
        throw new Error('The server returned no actor for EXPO_TOKEN.');
      }
      printJsonOnlyOutput({ status: 'signed-out' });
      process.exitCode = 1;
    } else {
      Log.warn('Not logged in');
      process.exit(1);
    }
  }
}
