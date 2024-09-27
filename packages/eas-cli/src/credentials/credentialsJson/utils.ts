import path from 'path';

import { IosCredentials } from './types';
import { Target } from '../ios/types';

export function getCredentialsJsonPath(projectDir: string): string {
  return path.join(projectDir, 'credentials.json');
}

export function ensureAllTargetsAreConfigured(
  targets: Target[],
  credentialsJson: IosCredentials
): void {
  const notConfiguredTargets: string[] = [];
  for (const target of targets) {
    if (!(target.targetName in credentialsJson)) {
      notConfiguredTargets.push(target.targetName);
      continue;
    }
  }

  if (notConfiguredTargets.length > 0) {
    const errorMessage =
      targets.length === 1
        ? 'Credentials are not defined in credentials.json'
        : `Credentials for target${
            notConfiguredTargets.length === 1 ? '' : 's'
          } ${notConfiguredTargets
            .map(i => `'${i}'`)
            .join(',')} are not defined in credentials.json`;
    throw new Error(errorMessage);
  }
}
