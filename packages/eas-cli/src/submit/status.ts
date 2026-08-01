import { App, Platform as ApplePlatform, AppStoreVersion, Build } from '@expo/apple-utils';
import chalk from 'chalk';

import { getSubmissionDetailsUrl } from './utils/urls';
import {
  AppPlatform,
  SubmissionAndroidReleaseStatus,
  SubmissionStatus,
  SubmissionWithSubmittedBuildFragment,
} from '../graphql/generated';
import Log, { link } from '../log';
import { fromNow } from '../utils/date';
import formatFields, { FormatFieldsItem } from '../utils/formatFields';

const TESTFLIGHT_BUILDS_LIMIT = 5;

export type IosStoreVersionStatus = {
  versionString: string;
  buildNumber: string | null;
  state: string | null;
  easSubmissionId: string | null;
  easBuildId: string | null;
};

export type IosTestFlightBuildStatus = {
  appVersion: string | null;
  buildNumber: string;
  processingState: string;
  internalState: string | null;
  externalState: string | null;
  uploadedDate: string;
  expired: boolean;
  easSubmissionId: string | null;
  easBuildId: string | null;
};

export type IosStoreStatus = {
  ascAppIdentifier: string;
  live: IosStoreVersionStatus | null;
  inReview: IosStoreVersionStatus | null;
  pendingRelease: IosStoreVersionStatus | null;
  testFlightBuilds: IosTestFlightBuildStatus[];
};

export type AndroidTrackStatus = {
  track: string;
  appVersion: string | null;
  versionCode: string | null;
  releaseStatus: string | null;
  rollout: number | null;
  submissionId: string;
  submissionCompletedAt: string | null;
};

export async function getIosStoreStatusAsync(
  app: App,
  easSubmissions: SubmissionWithSubmittedBuildFragment[]
): Promise<IosStoreStatus> {
  const [live, inReview, pendingRelease, builds] = await Promise.all([
    app.getLiveAppStoreVersionAsync({ platform: ApplePlatform.IOS }),
    app.getInReviewAppStoreVersionAsync({ platform: ApplePlatform.IOS }),
    app.getPendingReleaseAppStoreVersionAsync({ platform: ApplePlatform.IOS }),
    Build.getAsync(app.context, {
      query: {
        filter: { app: app.id },
        sort: '-uploadedDate',
        limit: TESTFLIGHT_BUILDS_LIMIT,
        includes: ['buildBetaDetail', 'preReleaseVersion'],
      },
    }),
  ]);

  return {
    ascAppIdentifier: app.id,
    live: await toStoreVersionStatusAsync(live, easSubmissions),
    inReview: await toStoreVersionStatusAsync(inReview, easSubmissions),
    pendingRelease: await toStoreVersionStatusAsync(pendingRelease, easSubmissions),
    // The ASC limit param only caps the page size and the client auto-paginates, so cap here too.
    testFlightBuilds: builds
      .slice(0, TESTFLIGHT_BUILDS_LIMIT)
      .map(build => toTestFlightBuildStatus(build, easSubmissions)),
  };
}

async function toStoreVersionStatusAsync(
  version: AppStoreVersion | null,
  easSubmissions: SubmissionWithSubmittedBuildFragment[]
): Promise<IosStoreVersionStatus | null> {
  if (!version) {
    return null;
  }
  const build = await version.getBuildAsync();
  const buildNumber = build?.attributes.version ?? null;
  const easSubmission = buildNumber
    ? findEasSubmissionByBuildNumber(easSubmissions, buildNumber, version.attributes.versionString)
    : null;
  return {
    versionString: version.attributes.versionString,
    buildNumber,
    state: version.attributes.appVersionState ?? version.attributes.appStoreState ?? null,
    easSubmissionId: easSubmission?.id ?? null,
    easBuildId: easSubmission?.submittedBuild?.id ?? null,
  };
}

function toTestFlightBuildStatus(
  build: Build,
  easSubmissions: SubmissionWithSubmittedBuildFragment[]
): IosTestFlightBuildStatus {
  const buildNumber = build.attributes.version;
  const appVersion = build.attributes.preReleaseVersion?.attributes.version ?? null;
  const easSubmission = findEasSubmissionByBuildNumber(easSubmissions, buildNumber, appVersion);
  return {
    appVersion,
    buildNumber,
    processingState: build.attributes.processingState,
    internalState: build.attributes.buildBetaDetail?.attributes.internalBuildState ?? null,
    externalState: build.attributes.buildBetaDetail?.attributes.externalBuildState ?? null,
    uploadedDate: build.attributes.uploadedDate,
    expired: build.attributes.expired,
    easSubmissionId: easSubmission?.id ?? null,
    easBuildId: easSubmission?.submittedBuild?.id ?? null,
  };
}

function findEasSubmissionByBuildNumber(
  easSubmissions: SubmissionWithSubmittedBuildFragment[],
  buildNumber: string,
  appVersion?: string | null
): SubmissionWithSubmittedBuildFragment | null {
  return (
    easSubmissions.find(
      submission =>
        submission.submittedBuild?.appBuildVersion === buildNumber &&
        (!appVersion || submission.submittedBuild?.appVersion === appVersion)
    ) ?? null
  );
}

export function getAndroidTrackStatuses(
  easSubmissions: SubmissionWithSubmittedBuildFragment[]
): AndroidTrackStatus[] {
  const finishedSubmissions = easSubmissions.filter(
    submission =>
      submission.platform === AppPlatform.Android &&
      submission.status === SubmissionStatus.Finished &&
      submission.androidConfig?.track
  );

  const latestByTrack = new Map<string, SubmissionWithSubmittedBuildFragment>();
  for (const submission of finishedSubmissions) {
    const track = submission.androidConfig!.track;
    // Submissions arrive newest-first, so the first one wins for each track.
    if (!latestByTrack.has(track)) {
      latestByTrack.set(track, submission);
    }
  }

  return [...latestByTrack.entries()].map(([track, submission]) => ({
    track,
    appVersion: submission.submittedBuild?.appVersion ?? null,
    versionCode: submission.submittedBuild?.appBuildVersion ?? null,
    releaseStatus: submission.androidConfig?.releaseStatus ?? null,
    rollout: submission.androidConfig?.rollout ?? null,
    submissionId: submission.id,
    submissionCompletedAt: submission.completedAt ?? null,
  }));
}

export function renderIosStoreStatus(
  status: IosStoreStatus,
  easSubmissions: SubmissionWithSubmittedBuildFragment[]
): void {
  Log.addNewLineIfNone();
  Log.log(chalk.bold('iOS — App Store Connect'));

  Log.newLine();
  Log.log(chalk.bold('App Store'));
  renderStoreVersion('Live', status.live, easSubmissions);
  renderStoreVersion('In review', status.inReview, easSubmissions);
  renderStoreVersion('Pending release', status.pendingRelease, easSubmissions);

  Log.newLine();
  Log.log(chalk.bold('TestFlight (latest uploads)'));
  if (status.testFlightBuilds.length === 0) {
    Log.log(chalk.dim('  No builds found.'));
    return;
  }
  for (const build of status.testFlightBuilds) {
    const version = `${build.appVersion ?? '?'} (${build.buildNumber})`;
    const states: string[] = [];
    if (build.expired) {
      states.push(chalk.gray('expired'));
    } else if (build.processingState !== 'VALID') {
      states.push(chalk.yellow(build.processingState.toLowerCase()));
    } else {
      if (build.internalState) {
        states.push(`internal: ${formatBetaState(build.internalState)}`);
      }
      if (build.externalState) {
        states.push(`external: ${formatBetaState(build.externalState)}`);
      }
    }
    const uploaded = `uploaded ${fromNow(new Date(build.uploadedDate))} ago`;
    Log.log(`  ${chalk.bold(version)} — ${states.join(', ')} — ${uploaded}`);
    logEasLinkage(build.easSubmissionId, build.easBuildId, easSubmissions);
  }
}

function renderStoreVersion(
  label: string,
  version: IosStoreVersionStatus | null,
  easSubmissions: SubmissionWithSubmittedBuildFragment[]
): void {
  if (!version) {
    Log.log(`  ${chalk.dim(`${label}: none`)}`);
    return;
  }
  const versionText = version.buildNumber
    ? `${version.versionString} (${version.buildNumber})`
    : version.versionString;
  const state = version.state ? formatStoreState(version.state) : '';
  Log.log(`  ${label}: ${chalk.bold(versionText)}${state ? ` — ${state}` : ''}`);
  logEasLinkage(version.easSubmissionId, version.easBuildId, easSubmissions);
}

function logEasLinkage(
  easSubmissionId: string | null,
  easBuildId: string | null,
  easSubmissions: SubmissionWithSubmittedBuildFragment[]
): void {
  if (!easSubmissionId) {
    return;
  }
  const submission = easSubmissions.find(s => s.id === easSubmissionId);
  const fields: FormatFieldsItem[] = [
    { label: 'EAS Submission', value: submission ? link(getSubmissionDetailsUrl(submission)) : easSubmissionId },
  ];
  if (easBuildId) {
    fields.push({ label: 'EAS Build ID', value: easBuildId });
  }
  Log.log(
    formatFields(fields)
      .split('\n')
      .map(line => `    ${line}`)
      .join('\n')
  );
}

export function renderAndroidTrackStatuses(statuses: AndroidTrackStatus[]): void {
  Log.addNewLineIfNone();
  Log.log(chalk.bold('Android — Google Play (from EAS submissions)'));
  if (statuses.length === 0) {
    Log.log(chalk.dim('  No finished submissions found.'));
    return;
  }
  for (const status of statuses) {
    const version =
      status.appVersion || status.versionCode
        ? `${status.appVersion ?? '?'} (${status.versionCode ?? '?'})`
        : 'unknown version';
    const details: string[] = [];
    if (status.releaseStatus) {
      details.push(`release status: ${formatAndroidReleaseStatus(status.releaseStatus)}`);
    }
    if (status.rollout != null) {
      details.push(`rollout: ${Math.round(status.rollout * 100)}%`);
    }
    if (status.submissionCompletedAt) {
      details.push(`submitted ${fromNow(new Date(status.submissionCompletedAt))} ago`);
    }
    Log.log(`  ${status.track}: ${chalk.bold(version)}${details.length ? ` — ${details.join(', ')}` : ''}`);
  }
  Log.log(
    chalk.dim(
      '  Play state is inferred from the latest finished EAS submission per track. Check the Play Console for the authoritative live state.'
    )
  );
}

function formatStoreState(state: string): string {
  const lower = state.toLowerCase().replace(/_/g, ' ');
  switch (state) {
    case 'READY_FOR_SALE':
    case 'READY_FOR_DISTRIBUTION':
      return chalk.green(lower);
    case 'REJECTED':
    case 'METADATA_REJECTED':
    case 'DEVELOPER_REJECTED':
    case 'INVALID_BINARY':
      return chalk.red(lower);
    default:
      return chalk.blue(lower);
  }
}

function formatBetaState(state: string): string {
  const lower = state.toLowerCase().replace(/_/g, ' ');
  switch (state) {
    case 'IN_BETA_TESTING':
    case 'BETA_APPROVED':
      return chalk.green(lower);
    case 'BETA_REJECTED':
    case 'PROCESSING_EXCEPTION':
    case 'MISSING_EXPORT_COMPLIANCE':
      return chalk.red(lower);
    case 'EXPIRED':
      return chalk.gray(lower);
    default:
      return chalk.blue(lower);
  }
}

function formatAndroidReleaseStatus(releaseStatus: string): string {
  const lower = releaseStatus.toLowerCase().replace(/_/g, ' ');
  switch (releaseStatus) {
    case SubmissionAndroidReleaseStatus.Completed:
      return chalk.green(lower);
    case SubmissionAndroidReleaseStatus.Halted:
      return chalk.red(lower);
    default:
      return chalk.blue(lower);
  }
}
