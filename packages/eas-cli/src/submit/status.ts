import { App, AppStoreVersion, Platform as ApplePlatform, Build } from '@expo/apple-utils';
import chalk from 'chalk';

import { getSubmissionDetailsUrl } from './utils/urls';
import { SubmissionWithSubmittedBuildFragment } from '../graphql/generated';
import Log, { link } from '../log';
import { fromNow } from '../utils/date';
import formatFields, { FormatFieldsItem } from '../utils/formatFields';
import { sanitizeTerminalText } from '../utils/terminalText';

const TESTFLIGHT_BUILDS_LIMIT = 5;

export type EasBuildLinkage = {
  easSubmissionId: string | null;
  easBuildId: string | null;
  runtimeVersion: string | null;
  fingerprintHash: string | null;
};

export type IosStoreVersionStatus = EasBuildLinkage & {
  versionString: string;
  buildNumber: string | null;
  state: string | null;
};

export type IosTestFlightBuildStatus = EasBuildLinkage & {
  appVersion: string | null;
  buildNumber: string;
  processingState: string;
  internalState: string | null;
  externalState: string | null;
  uploadedDate: string;
  expired: boolean;
};

export type IosStoreStatus = {
  ascAppIdentifier: string;
  live: IosStoreVersionStatus | null;
  inReview: IosStoreVersionStatus | null;
  pendingRelease: IosStoreVersionStatus | null;
  testFlightBuilds: IosTestFlightBuildStatus[];
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
  // Values stay raw here so --json reports exactly what the APIs returned; the render
  // functions sanitize at print time.
  return {
    versionString: version.attributes.versionString,
    buildNumber,
    state: version.attributes.appVersionState ?? version.attributes.appStoreState ?? null,
    ...toEasBuildLinkage(easSubmission),
  };
}

function toEasBuildLinkage(
  easSubmission: SubmissionWithSubmittedBuildFragment | null
): EasBuildLinkage {
  return {
    easSubmissionId: easSubmission?.id ?? null,
    easBuildId: easSubmission?.submittedBuild?.id ?? null,
    runtimeVersion: easSubmission?.submittedBuild?.runtime?.version ?? null,
    fingerprintHash: easSubmission?.submittedBuild?.fingerprint?.hash ?? null,
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
    ...toEasBuildLinkage(easSubmission),
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
    const version = sanitizeTerminalText(`${build.appVersion ?? '?'} (${build.buildNumber})`);
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
    logEasLinkage(build, easSubmissions);
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
  const versionText = sanitizeTerminalText(
    version.buildNumber
      ? `${version.versionString} (${version.buildNumber})`
      : version.versionString
  );
  const state = version.state ? formatStoreState(version.state) : '';
  Log.log(`  ${label}: ${chalk.bold(versionText)}${state ? ` — ${state}` : ''}`);
  logEasLinkage(version, easSubmissions);
}

function logEasLinkage(
  linkage: EasBuildLinkage,
  easSubmissions: SubmissionWithSubmittedBuildFragment[]
): void {
  if (!linkage.easSubmissionId) {
    return;
  }
  const submission = easSubmissions.find(s => s.id === linkage.easSubmissionId);
  const fields: FormatFieldsItem[] = [
    {
      label: 'EAS Submission',
      value: submission ? link(getSubmissionDetailsUrl(submission)) : linkage.easSubmissionId,
    },
  ];
  if (linkage.easBuildId) {
    fields.push({ label: 'EAS Build ID', value: linkage.easBuildId });
  }
  if (linkage.runtimeVersion) {
    fields.push({ label: 'Runtime Version', value: sanitizeTerminalText(linkage.runtimeVersion) });
  }
  if (linkage.fingerprintHash) {
    fields.push({ label: 'Fingerprint', value: linkage.fingerprintHash });
  }
  Log.log(
    formatFields(fields)
      .split('\n')
      .map(line => `    ${line}`)
      .join('\n')
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
