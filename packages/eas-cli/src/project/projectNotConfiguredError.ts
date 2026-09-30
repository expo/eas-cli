import { Actor, getCreatableAccountNames } from '../user/User';

/**
 * Build the error shown when an EAS project is not configured and the CLI cannot configure it
 * without more input. Lists the exact commands to run, because bare "eas init" also needs
 * interaction and fails in the same situation.
 *
 * @param actor the logged-in actor
 * @param accountName the account that should own the project, when it is already known
 * @param reason why the CLI cannot configure the project here
 * @param additionalFix an extra way to resolve the error, appended at the end
 */
export function getUnconfiguredProjectError({
  actor,
  accountName,
  reason = 'This command cannot configure it in non-interactive mode.',
  additionalFix,
}: {
  actor: Actor;
  accountName?: string;
  reason?: string;
  additionalFix?: string;
}): Error {
  return new Error(
    `EAS project not configured. ${reason} ` +
      `Run one of the following, then re-run this command:\n\n` +
      `To link an existing project:\n\n` +
      `  eas init --id <project-id> --non-interactive\n\n` +
      `To create a new project:\n\n` +
      `  eas init --account ${accountName ?? '<account-name>'} --non-interactive\n\n` +
      `Accounts you can create projects in: ${getCreatableAccountNames(actor).join(', ')}` +
      (additionalFix ? `\n\n${additionalFix}` : '')
  );
}
