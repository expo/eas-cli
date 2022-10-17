import chalk from 'chalk';

import Log from '../../log';

export function assertPlatform(): void {
  if (process.platform !== 'darwin') {
    Log.error(
      chalk`iOS apps can only be built on macOS devices. Use {cyan eas build -p ios} to build in the cloud.`
    );
    throw Error('iOS apps can only be built on macOS devices.');
  }
}
