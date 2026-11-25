import { Actor, getCreatableAccountNames } from '../user/User';

/**
 * Build the error shown when an EAS project is not configured and the CLI cannot configure it
 * without more input. Lists the exact commands to run, because bare "eas init" also needs
 * interaction and fails in the same situation.
 */
export class ProjectNotConfiguredError extends Error {
  readonly accountName?: string;
  readonly accountsWithProjectCreationPermission: string[];

  constructor({
    actor,
    accountName,
    reason = 'This command cannot configure it in non-interactive mode.',
    additionalFix,
  }: {
    actor: Actor;
    accountName?: string;
    reason?: string;
    additionalFix?: string;
  }) {
    const accountsWithProjectCreationPermission = getCreatableAccountNames(actor);
    const accountsMessage = accountsWithProjectCreationPermission.length
      ? `Accounts you can create projects in: ${accountsWithProjectCreationPermission.join(', ')}`
      : 'Your current credential cannot create projects in any account.';
    const targetMessage =
      accountName &&
      accountsWithProjectCreationPermission.length &&
      !accountsWithProjectCreationPermission.includes(accountName)
        ? `\nCreating a project in ${accountName} requires a credential with permission to create projects there.`
        : '';
    super(
      `EAS project not configured. ${reason} Run one of the following, then re-run this command:\n\n` +
        'To link an existing project:\n\n  eas init --id <project-id> --non-interactive\n\n' +
        `To create a new project:\n\n  eas init --account ${accountName ?? '<account-name>'} --non-interactive\n\n` +
        accountsMessage +
        targetMessage +
        (additionalFix ? `\n\n${additionalFix}` : '')
    );
    this.accountName = accountName;
    this.accountsWithProjectCreationPermission = accountsWithProjectCreationPermission;
  }
}
