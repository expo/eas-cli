import chalk from 'chalk';
import Table from 'cli-table3';
import fs from 'fs-extra';
import chunk from 'lodash/chunk';

import log from '../../log';
import BaseSubmitter from '../BaseSubmitter';
import { Archive, ArchiveSource, getArchiveAsync } from '../archive-source';
import {
  AndroidArchiveType,
  AndroidSubmissionContext,
  ArchiveType,
  SubmissionPlatform,
} from '../types';
import { AndroidPackageSource, getAndroidPackageAsync } from './AndroidPackageSource';
import { AndroidSubmissionConfig, ReleaseStatus, ReleaseTrack } from './AndroidSubmissionConfig';
import { ServiceAccountSource, getServiceAccountAsync } from './ServiceAccountSource';

export interface AndroidSubmissionOptions
  extends Pick<AndroidSubmissionConfig, 'track' | 'releaseStatus' | 'projectId'> {
  androidPackageSource: AndroidPackageSource;
  archiveSource: ArchiveSource;
  serviceAccountSource: ServiceAccountSource;
}

interface ResolvedSourceOptions {
  androidPackage: string;
  archive: Archive;
  serviceAccountPath: string;
}

class AndroidSubmitter extends BaseSubmitter<AndroidSubmissionContext, AndroidSubmissionOptions> {
  protected readonly appStoreName = 'Google Play Store';

  constructor(ctx: AndroidSubmissionContext, options: AndroidSubmissionOptions) {
    super(SubmissionPlatform.Android, ctx, options);
  }

  async submitAsync(): Promise<void> {
    const resolvedSourceOptions = await this.resolveSourceOptions();
    const submissionConfig = await this.formatSubmissionConfigAndPrintSummary(
      this.options,
      resolvedSourceOptions
    );
    await this.startSubmissionAsync(submissionConfig, this.ctx.commandFlags.verbose);
  }

  private async resolveSourceOptions(): Promise<ResolvedSourceOptions> {
    const androidPackage = await getAndroidPackageAsync(this.options.androidPackageSource);
    const archive = await getArchiveAsync(SubmissionPlatform.Android, this.options.archiveSource);
    const serviceAccountPath = await getServiceAccountAsync(this.options.serviceAccountSource);
    return {
      androidPackage,
      archive,
      serviceAccountPath,
    };
  }

  private async formatSubmissionConfigAndPrintSummary(
    options: AndroidSubmissionOptions,
    { archive, androidPackage, serviceAccountPath }: ResolvedSourceOptions
  ): Promise<AndroidSubmissionConfig> {
    const serviceAccount = await fs.readFile(serviceAccountPath, 'utf-8');
    const { track, releaseStatus, projectId } = options;
    const submissionConfig = {
      androidPackage,
      archiveUrl: archive.location,
      archiveType: archive.type as AndroidArchiveType,
      track,
      releaseStatus,
      projectId,
    };
    printSummary({
      ...submissionConfig,
      serviceAccountPath,
    });
    return { ...submissionConfig, serviceAccount };
  }
}

interface Summary {
  androidPackage: string;
  archivePath?: string;
  archiveUrl?: string;
  archiveType: ArchiveType;
  serviceAccountPath: string;
  track: ReleaseTrack;
  releaseStatus?: ReleaseStatus;
  projectId?: string;
}

const SummaryHumanReadableKeys: Record<keyof Summary, string> = {
  androidPackage: 'Android package',
  archivePath: 'Archive path',
  archiveUrl: 'Archive URL',
  archiveType: 'Archive type',
  serviceAccountPath: 'Google Service Account',
  track: 'Release track',
  releaseStatus: 'Release status',
  projectId: 'Project ID',
};

const SummaryHumanReadableValues: Partial<Record<keyof Summary, Function>> = {
  archivePath: (path: string) => breakWord(path, 50),
  archiveUrl: (url: string) => breakWord(url, 50),
};

function breakWord(word: string, chars: number): string {
  return chunk(word, chars)
    .map((arr: string[]) => arr.join(''))
    .join('\n');
}

function printSummary(summary: Summary): void {
  const table = new Table({
    colWidths: [25, 55],
    wordWrap: true,
  });
  table.push([
    {
      colSpan: 2,
      content: chalk.bold('Android Submission Summary'),
      hAlign: 'center',
    },
  ]);
  for (const [key, value] of Object.entries(summary)) {
    const displayKey = SummaryHumanReadableKeys[key as keyof Summary];
    const displayValue = SummaryHumanReadableValues[key as keyof Summary]?.(value) ?? value;
    table.push([displayKey, displayValue]);
  }
  log(table.toString());
}

export default AndroidSubmitter;
