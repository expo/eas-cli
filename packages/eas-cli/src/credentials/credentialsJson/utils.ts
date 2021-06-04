import path from 'path';

import { Target } from '../ios/types';
import { IosCredentials } from './types';

export function getCredentialsJsonPath(projectDir: string): string {
  return path.join(projectDir, 'credentials.json');
}

export function ensureAllTargetsAreConfigured(targets: Target[], credentialsJson: IosCredentials) {
  const notConfiguredTargets: string[] = [];
  for (const target of targets) {
    if (!(target.targetName in credentialsJson)) {
      notConfiguredTargets.push(target.targetName);
      continue;
    }
  }

  if (notConfiguredTargets.length > 0) {
    throw new Error(
      `Credentials for target${
        notConfiguredTargets.length === 1 ? '' : 's'
      } ${notConfiguredTargets.map(i => `'${i}'`).join(',')} are not defined in credentials.json`
    );
  }
}
