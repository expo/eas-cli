import { Ora, ora } from '../../ora';

type LogAsyncOptions = {
  /** If the spinner representing the async action should be hidden, e.g. for JSON output */
  hidden?: boolean;
  /** The message to display when the action is pending */
  pending: string;
  /** The message to display when the action succeeded */
  success: string;
  /** The message to display when the action failed */
  failure: string;
};

/**
 * Log an asynchronous action using a spinner.
 */
export async function logAsync<T>(
  action: (spinner?: Ora) => Promise<T>,
  { hidden, ...message }: LogAsyncOptions
): Promise<T> {
  if (hidden) {
    return await action();
  }

  const spinner = ora(message.pending).start();
  try {
    const result = await action(spinner);
    spinner.succeed(message.success);
    return result;
  } catch (error) {
    spinner.fail(message.failure);
    throw error;
  }
}
