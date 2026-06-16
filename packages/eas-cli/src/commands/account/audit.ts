import { Args, Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EASNonInteractiveFlag, EasJsonOnlyFlag } from '../../commandUtils/flags';
import { getLimitFlagWithCustomValues } from '../../commandUtils/pagination';
import { AuditLogFragment } from '../../graphql/generated';
import { AuditLogQuery } from '../../graphql/queries/AuditLogQuery';
import Log from '../../log';
import { ora } from '../../ora';
import { confirmAsync, selectAsync } from '../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';
import renderTextTable from '../../utils/renderTextTable';

const AUDIT_LOGS_LIMIT = 50;

export default class AccountAudit extends EasCommand {
  static override description = 'view the audit logs for an account';

  static override args = {
    ACCOUNT_NAME: Args.string({
      description:
        'Account name to view audit logs for. If not provided, the account will be selected interactively (or defaults to the only account if there is just one)',
    }),
  };

  static override flags = {
    limit: getLimitFlagWithCustomValues({ defaultTo: AUDIT_LOGS_LIMIT, limit: 100 }),
    after: Flags.string({
      description:
        'Cursor for pagination. Use the endCursor from a previous query to fetch the next page.',
    }),
    ...EasJsonOnlyFlag,
    ...EASNonInteractiveFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const {
      args: { ACCOUNT_NAME: accountName },
      flags: { limit, after, json: jsonFlag, 'non-interactive': nonInteractive },
    } = await this.parse(AccountAudit);

    const json = jsonFlag || nonInteractive;
    if (json) {
      enableJsonOutput();
    }

    const {
      loggedIn: { graphqlClient, actor },
    } = await this.getContextAsync(AccountAudit, { nonInteractive });

    const pageSize = limit ?? AUDIT_LOGS_LIMIT;

    let targetAccount: { id: string; name: string };
    const availableAccounts = actor.accounts.map(a => a.name).join(', ');
    if (accountName) {
      const found = actor.accounts.find(a => a.name === accountName);
      if (!found) {
        throw new Error(
          `Account "${accountName}" not found or you don't have access. Available accounts: ${availableAccounts}`
        );
      }
      targetAccount = found;
    } else if (nonInteractive) {
      throw new Error(
        'ACCOUNT_NAME argument must be provided when running in `--non-interactive` mode.'
      );
    } else if (actor.accounts.length === 1) {
      targetAccount = actor.accounts[0];
    } else {
      targetAccount = await selectAsync(
        'Select account to view audit logs for:',
        actor.accounts.map(account => ({
          title: account.name,
          value: account,
        }))
      );
    }

    if (json) {
      const spinner = ora(`Fetching audit logs for account ${targetAccount.name}`).start();
      try {
        const connection = await AuditLogQuery.getAllForAccountAsync(
          graphqlClient,
          targetAccount.id,
          {
            first: pageSize,
            after,
          }
        );
        spinner.stop();
        printJsonOnlyOutput({
          auditLogs: connection.edges.map(edge => edge.node),
          pageInfo: connection.pageInfo,
        });
      } catch (error) {
        spinner.fail(`Failed to fetch audit logs for account ${targetAccount.name}`);
        throw error;
      }
      return;
    }

    let cursor = after;
    do {
      const spinner = ora(`Fetching audit logs for account ${targetAccount.name}`).start();
      const connection = await AuditLogQuery.getAllForAccountAsync(
        graphqlClient,
        targetAccount.id,
        {
          first: pageSize,
          after: cursor,
        }
      );
      spinner.stop();

      const logs = connection.edges.map(edge => edge.node);
      renderPageOfAuditLogs(logs);

      if (!connection.pageInfo.hasNextPage) {
        break;
      }
      cursor = connection.pageInfo.endCursor ?? undefined;
    } while (cursor && (await confirmAsync({ message: 'Load more audit logs?' })));
  }
}

function renderPageOfAuditLogs(logs: AuditLogFragment[]): void {
  if (logs.length === 0) {
    Log.log('No audit logs found.');
    return;
  }

  Log.log(
    renderTextTable(
      ['Date', 'Actor', 'Action', 'Entity', 'Message'],
      logs.map(log => [
        new Date(log.createdAt).toLocaleString(),
        log.actor?.displayName ?? 'Unknown',
        log.targetEntityMutationType,
        log.targetEntityTypePublicName,
        log.websiteMessage,
      ])
    )
  );
  Log.addNewLineIfNone();
}
