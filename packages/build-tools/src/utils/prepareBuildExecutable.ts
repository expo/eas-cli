import path from 'path';

import { Job } from '@expo/eas-build-job';
import fs from 'fs-extra';

import { BuildContext } from '../context';

export async function prepareExecutableAsync(ctx: BuildContext<Job>): Promise<void> {
  await fs.copy(
    path.join(__dirname, '../../bin/set-env'),
    path.join(ctx.buildExecutablesDirectory, 'set-env')
  );
}
