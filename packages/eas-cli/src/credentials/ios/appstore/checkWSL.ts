import fs from 'fs-extra';
import { release } from 'os';

import { WSL_BASH_PATH } from './fastlane';

const ENABLE_WSL = `
Does not seem like WSL is enabled on this machine. Download from
the Windows app store a distribution of Linux, then in an admin powershell run:

Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux

and run the new Linux installation at least once
`;

let checkCompleted = false;
export async function checkWSLAsync() {
  if (checkCompleted) {
    return;
  }

  if (process.platform === 'win32') {
    const [version] = release().match(/\d./) || [null];
    if (version !== '10') {
      throw new Error('Must be on at least Windows version 10 for WSL support to work');
    }

    try {
      await fs.access(WSL_BASH_PATH, fs.constants.F_OK);
    } catch (e) {
      throw new Error(ENABLE_WSL);
    }
  }

  checkCompleted = true;
}
