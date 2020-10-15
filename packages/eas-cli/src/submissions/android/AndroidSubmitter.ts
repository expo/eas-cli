import chalk from 'chalk';
import Table from 'cli-table3';
import fs from 'fs-extra';
import chunk from 'lodash/chunk';
import ora from 'ora';

import log from '../../log';
import { sleep } from '../../utils/promise';
import SubmissionService, { DEFAULT_CHECK_INTERVAL_MS } from '../SubmissionService';
import { Platform, Submission, SubmissionStatus } from '../SubmissionService.types';
import { Archive, ArchiveSource, getArchiveAsync } from '../archive-source';
import { SubmissionPlatform } from '../types';
import { displayLogs } from '../utils/logs';
import { AndroidPackageSource, getAndroidPackageAsync } from './AndroidPackageSource';
import {
  AndroidSubmissionConfig,
  ArchiveType,
  ReleaseStatus,
  ReleaseTrack,
} from './AndroidSubmissionConfig';
import { ServiceAccountSource, getServiceAccountAsync } from './ServiceAccountSource';
import { AndroidSubmissionContext } from './types';

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

class AndroidSubmitter {
  constructor(private ctx: AndroidSubmissionContext, private options: AndroidSubmissionOptions) {}

  async submitAsync(): Promise<void> {
    const resolvedSourceOptions = await this.resolveSourceOptions();

    const submissionConfig = await this.formatSubmissionConfigAndPrintSummary(
      this.options,
      resolvedSourceOptions
    );
    await this.startSubmissionAsync(submissionConfig, this.ctx.commandFlags.verbose);
  }

  private async startSubmissionAsync(
    submissionConfig: AndroidSubmissionConfig,
    verbose: boolean = false
  ): Promise<void> {
    const scheduleSpinner = ora('Scheduling submission').start();
    let submissionId: string;
    try {
      submissionId = await SubmissionService.startSubmissionAsync(
        Platform.ANDROID,
        submissionConfig.projectId,
        submissionConfig
      );
      scheduleSpinner.succeed();
    } catch (err) {
      scheduleSpinner.fail('Failed to schedule submission');
      throw err;
    }

    let submissionCompleted = false;
    let submissionStatus: SubmissionStatus | null = null;
    let submission: Submission | null = null;
    const submissionSpinner = ora('Submitting your app to Google Play Store').start();
    try {
      while (!submissionCompleted) {
        await sleep(DEFAULT_CHECK_INTERVAL_MS);
        submission = await SubmissionService.getSubmissionAsync(
          submissionConfig.projectId,
          submissionId
        );
        submissionSpinner.text = AndroidSubmitter.getStatusText(submission.status);
        submissionStatus = submission.status;
        if (submissionStatus === SubmissionStatus.ERRORED) {
          submissionCompleted = true;
          process.exitCode = 1;
          submissionSpinner.fail();
        } else if (submissionStatus === SubmissionStatus.FINISHED) {
          submissionCompleted = true;
          submissionSpinner.succeed();
        }
      }
    } catch (err) {
      submissionSpinner.fail(AndroidSubmitter.getStatusText(SubmissionStatus.ERRORED));
      throw err;
    }

    await displayLogs(submission, submissionStatus, verbose);
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
      archiveType: archive.type,
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

  private static getStatusText(status: SubmissionStatus): string {
    if (status === SubmissionStatus.IN_QUEUE) {
      return 'Submitting your app to Google Play Store: waiting for an available submitter';
    } else if (status === SubmissionStatus.IN_PROGRESS) {
      return 'Submitting your app to Google Play Store: submission in progress';
    } else if (status === SubmissionStatus.FINISHED) {
      return 'Successfully submitted your app to Google Play Store!';
    } else if (status === SubmissionStatus.ERRORED) {
      return 'Something went wrong when submitting your app to Google Play Store.';
    } else {
      throw new Error('This should never happen');
    }
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
