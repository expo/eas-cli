import { Artifacts } from '@expo/build-tools';

import logger from '../logger';

let shouldSucceed = true;

export function setShouldSucceed(newShouldSucceed: boolean): void {
  shouldSucceed = newShouldSucceed;
}

export async function build(): Promise<Artifacts> {
  logger.debug('Called mock build()');
  if (shouldSucceed) {
    return {
      APPLICATION_ARCHIVE: 'dummy_application_archive',
      BUILD_ARTIFACTS: 'dummy_build_artifacts',
      XCODE_BUILD_LOGS: 'dummy_build_logs',
    };
  } else {
    throw new Error('Build failed');
  }
}
