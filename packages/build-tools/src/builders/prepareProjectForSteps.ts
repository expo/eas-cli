import { BuildJob, BuildPhase } from '@expo/eas-build-job';
import fs from 'fs/promises';

import { prepareProjectSourcesAsync } from '../common/projectSources';
import { BuildContext } from '../context';
import { retryAsync } from '../utils/retry';

export async function prepareProjectForStepsAsync(
  ctx: BuildContext<BuildJob>,
  projectSourceDirectory: string
): Promise<void> {
  await ctx.runBuildPhase(BuildPhase.PREPARE_PROJECT, async () => {
    await retryAsync(
      async () => {
        await fs.rm(projectSourceDirectory, { recursive: true, force: true });
        await fs.mkdir(projectSourceDirectory, { recursive: true });

        await prepareProjectSourcesAsync(ctx, projectSourceDirectory);
      },
      {
        retryOptions: {
          retries: 3,
          retryIntervalMs: 1_000,
        },
      }
    );
  });
}
