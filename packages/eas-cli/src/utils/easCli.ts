const packageJSON = require('../../package.json');

export const easCliVersion: string = packageJSON.version;

/**
 * Check if the experimental account switcher feature is enabled.
 * This allows users to log in to multiple accounts and switch between them.
 *
 * Enable with: EAS_EXPERIMENTAL_ACCOUNT_SWITCHER=1
 */
export function isMultiAccountEnabled(): boolean {
  return process.env.EAS_EXPERIMENTAL_ACCOUNT_SWITCHER === '1';
}
