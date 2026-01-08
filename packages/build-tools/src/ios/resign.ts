import assert from 'assert';
import path from 'path';

import downloadFile from '@expo/downloader';
import { ArchiveSourceType, Ios } from '@expo/eas-build-job';

import { BuildContext } from '../context';

export async function downloadApplicationArchiveAsync(ctx: BuildContext<Ios.Job>): Promise<string> {
  assert(ctx.job.resign);

  const applicationArchivePath = path.join(ctx.workingdir, 'application.ipa');

  const { applicationArchiveSource } = ctx.job.resign;
  if (applicationArchiveSource.type === ArchiveSourceType.URL) {
    try {
      await downloadFile(applicationArchiveSource.url, applicationArchivePath, { retry: 3 });
    } catch (err: any) {
      ctx.reportError?.('Failed to download the application archive', err, {
        extras: { buildId: ctx.env.EAS_BUILD_ID },
      });
      throw err;
    }
  } else {
    throw new Error('Only application archive URLs are supported');
  }

  return applicationArchivePath;
}
