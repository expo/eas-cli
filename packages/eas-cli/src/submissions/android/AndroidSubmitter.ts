import fs from 'fs-extra';

import BaseSubmitter from '../BaseSubmitter';
import { Archive, ArchiveSource, getArchiveAsync } from '../archiveSource';
import {
  AndroidArchiveType,
  AndroidSubmissionContext,
  ArchiveType,
  SubmissionPlatform,
} from '../types';
import { printSummary } from '../utils/summary';
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

    printSummaryAndroid({
      ...submissionConfig,
      serviceAccountPath,
    });
    return { ...submissionConfig, serviceAccount };
  }
}

/**
 * Log the summary as a table. Exported for testing locally.
 *
 * @example
 * printSummaryAndroid({
 *   androidPackage: 'com.expo.demoapp',
 *   archivePath: '/Users/example/Documents/863f9337-65d2-40c6-acb3-c1054c5c09f8.apk',
 *   archiveUrl: 'https://turtle-v2-artifacts.s3.amazonaws.com/ios/6420592d-5b5d-439b-aed4-ccd278647138-ca4145d8468947df9ded737248a1a238.aab',
 *   archiveType: 'apk' as any,
 *   serviceAccountPath: '/Users/example/Documents/gsa.json',
 *   track: ReleaseTrack.production,
 *   releaseStatus: ReleaseStatus.completed,
 *   projectId: '863f9337-65d2-40c6-acb3-c1054c5c09f8',
 * });
 * @param submissionConfig
 */
export function printSummaryAndroid(submissionConfig: Summary) {
  printSummary(submissionConfig, SummaryHumanReadableKeys, SummaryHumanReadableValues);
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
  archiveUrl: 'Download URL',
  archiveType: 'Archive type',
  serviceAccountPath: 'Google Service Account',
  track: 'Release track',
  releaseStatus: 'Release status',
  projectId: 'Project ID',
};

const SummaryHumanReadableValues: Partial<Record<keyof Summary, Function>> = {};

export default AndroidSubmitter;
