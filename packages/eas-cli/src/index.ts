import { run } from '@oclif/core';

/**
 * Invokes the `testcli-modern` CLI with args programmatically.
 *
 * @param {...string} args - args to pass to CLI.
 *
 * @returns {Promise<void>}
 */
export default async function eascliAsync(...args: any[]): Promise<unknown> {
  return run(args, import.meta.url);
}
