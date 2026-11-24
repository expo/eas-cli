import { Actor, getCreatableAccountNames } from '../user/User';

/**
 * Build the error shown when an EAS project is not configured and the CLI cannot configure it
 * without more input. Lists the exact commands to run, because bare "eas init" also needs
 * interaction and fails in the same situation.
 */
export class ProjectNotConfiguredError extends Error {
  readonly accountName?: string;
  readonly eligibleAccounts: string[];

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
    const eligibleAccounts = getCreatableAccountNames(actor);
    const canCreate =
      accountName === undefined
        ? eligibleAccounts.length > 0
        : eligibleAccounts.includes(accountName);
    const linkExisting =
      'To link an existing project:\n\n  eas init --id <project-id> --non-interactive';
    const guidance = canCreate
      ? `Run one of the following, then re-run this command:\n\n${linkExisting}\n\n` +
        `To create a new project:\n\n  eas init --account ${accountName ?? '<account-name>'} --non-interactive\n\n` +
        `Accounts you can create projects in: ${eligibleAccounts.join(', ')}`
      : linkExisting;
    super(
      `EAS project not configured. ${reason} ${guidance}` +
        (additionalFix ? `\n\n${additionalFix}` : '')
    );
    this.accountName = accountName;
    this.eligibleAccounts = eligibleAccounts;
  }
}
