import fs from 'fs-extra';
import path from 'path';

import config from './config';

export async function prepareWorkingdir(): Promise<void> {
  await fs.remove(config.workingdir);
  await fs.mkdirp(path.join(config.workingdir, 'artifacts'));
  await fs.mkdirp(path.join(config.workingdir, 'build'));
  await fs.mkdirp(path.join(config.workingdir, 'bin'));
  await fs.mkdirp(path.join(config.workingdir, 'env'));
  await fs.mkdirp(path.join(config.workingdir, 'temporary-custom-build'));
  await fs.mkdirp(path.join(config.workingdir, 'eas-environment-secrets'));
}

export async function cleanUpWorkingdir(): Promise<void> {
  await fs.remove(config.workingdir);
}
