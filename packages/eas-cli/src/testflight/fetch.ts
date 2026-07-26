import {
  App,
  BetaCrashLog,
  BetaFeedbackCrashSubmission,
  BetaFeedbackScreenshotSubmission,
} from '@expo/apple-utils';

import Log from '../log';

/**
 * The largest page size the App Store Connect API accepts. The apple-utils helpers always walk
 * every page, so we ask for the largest pages possible and paginate client-side from there.
 */
const MAX_PAGE_SIZE = 200;

/** Which kind of TestFlight beta feedback a submission is. Matches the workflow trigger context. */
export type BetaFeedbackType = 'crash' | 'screenshot';

/** Screenshot attached to a piece of TestFlight feedback. Its URL expires after a short while. */
export type TestFlightScreenshot = {
  url: string;
  width: number;
  height: number;
  expirationDate: string;
};

/** Fields shared by TestFlight screenshot feedback and TestFlight crash submissions. */
export type TestFlightSubmission = {
  id: string;
  createdDate: string;
  comment: string | null;
  deviceModel: string;
  osVersion: string;
  locale: string | null;
  timeZone: string | null;
  architecture: string | null;
  connectionType: string | null;
  deviceFamily: string | null;
  appUptimeInMilliseconds: number | null;
  batteryPercentage: number | null;
  diskBytesAvailable: number | null;
  diskBytesTotal: number | null;
  buildVersion: string | null;
  testerName: string | null;
  testerEmail: string | null;
};

export type TestFlightFeedback = TestFlightSubmission & {
  screenshots: TestFlightScreenshot[];
};

export type TestFlightCrash = TestFlightSubmission;

/**
 * A paginated view over one App Store Connect collection. App Store Connect has no offset-based
 * paging and apple-utils always walks every page, so the underlying fetch happens once and pages
 * are served from that result — which also makes the total count available for free.
 */
export type TestFlightQuery<T> = {
  queryAsync(limit: number, offset: number): Promise<T[]>;
  getTotalAsync(): Promise<number>;
};

function createQuery<T>(fetchAllAsync: () => Promise<T[]>): TestFlightQuery<T> {
  let all: Promise<T[]> | undefined;
  const allAsync = async (): Promise<T[]> => {
    all ??= fetchAllAsync();
    return await all;
  };

  return {
    async queryAsync(limit: number, offset: number): Promise<T[]> {
      return (await allAsync()).slice(offset, offset + limit);
    },
    async getTotalAsync(): Promise<number> {
      return (await allAsync()).length;
    },
  };
}

/**
 * The `build` and `tester` relationships are requested through `includes`, so they land on the
 * model attributes at runtime without being part of the attribute types.
 */
type SubmissionRelationships = {
  build?: { id: string; attributes?: { version?: string | null } } | null;
  tester?: {
    id: string;
    attributes?: { firstName?: string | null; lastName?: string | null; email?: string | null };
  } | null;
};

function formatTesterName(tester: SubmissionRelationships['tester']): string | null {
  const parts = [tester?.attributes?.firstName, tester?.attributes?.lastName].filter(
    (part): part is string => !!part
  );
  return parts.length > 0 ? parts.join(' ') : null;
}

function normalizeSubmission(submission: {
  id: string;
  attributes: Record<string, any>;
}): TestFlightSubmission {
  const attributes = submission.attributes as Record<string, any> & SubmissionRelationships;
  return {
    id: submission.id,
    createdDate: attributes.createdDate,
    comment: attributes.comment ?? null,
    deviceModel: attributes.deviceModel,
    osVersion: attributes.osVersion,
    locale: attributes.locale ?? null,
    timeZone: attributes.timeZone ?? null,
    architecture: attributes.architecture ?? null,
    connectionType: attributes.connectionType ?? null,
    deviceFamily: attributes.deviceFamily ?? null,
    appUptimeInMilliseconds: attributes.appUptimeInMilliseconds ?? null,
    batteryPercentage: attributes.batteryPercentage ?? null,
    diskBytesAvailable: attributes.diskBytesAvailable ?? null,
    diskBytesTotal: attributes.diskBytesTotal ?? null,
    buildVersion: attributes.build?.attributes?.version ?? null,
    testerName: formatTesterName(attributes.tester),
    // The tester relationship hides the email of testers who joined through a public link, in
    // which case the submission itself still carries the address they submitted feedback with.
    testerEmail: attributes.tester?.attributes?.email ?? attributes.email ?? null,
  };
}

function normalizeFeedback(submission: {
  id: string;
  attributes: Record<string, any>;
}): TestFlightFeedback {
  return {
    ...normalizeSubmission(submission),
    screenshots: ((submission.attributes.screenshots ?? []) as TestFlightScreenshot[]).map(
      screenshot => ({
        url: screenshot.url,
        width: screenshot.width,
        height: screenshot.height,
        expirationDate: screenshot.expirationDate,
      })
    ),
  };
}

/** Screenshot feedback that TestFlight testers submitted for the app, newest first. */
export function getTestFlightFeedbackQuery(app: App): TestFlightQuery<TestFlightFeedback> {
  return createQuery(async () => {
    const submissions = await app.getBetaFeedbackScreenshotSubmissionsAsync({
      query: { limit: MAX_PAGE_SIZE },
    });
    return submissions.map(normalizeFeedback);
  });
}

/** Crashes that TestFlight testers reported for the app, newest first. */
export function getTestFlightCrashesQuery(app: App): TestFlightQuery<TestFlightCrash> {
  return createQuery(async () => {
    const submissions = await app.getBetaFeedbackCrashSubmissionsAsync({
      query: { limit: MAX_PAGE_SIZE },
    });
    return submissions.map(normalizeSubmission);
  });
}

/** Fetch a single screenshot feedback submission by ID. */
export async function fetchTestFlightFeedbackAsync(
  app: App,
  feedbackId: string
): Promise<TestFlightFeedback> {
  const submission = await BetaFeedbackScreenshotSubmission.infoAsync(app.context, {
    id: feedbackId,
  });
  return normalizeFeedback(submission);
}

/**
 * Fetch a single crash submission together with its full crash log. The log is reported as `null`
 * when App Store Connect has not symbolicated or retained one for this submission.
 */
export async function fetchTestFlightCrashAsync(
  app: App,
  crashId: string
): Promise<{ crash: TestFlightCrash; logText: string | null }> {
  const submission = await BetaFeedbackCrashSubmission.infoAsync(app.context, { id: crashId });

  let logText: string | null = null;
  try {
    const crashLog = await BetaCrashLog.getCrashLogAsync(app.context, {
      betaFeedbackCrashSubmissionId: crashId,
    });
    logText = crashLog.attributes.logText ?? null;
  } catch (error: any) {
    Log.debug(`Failed to fetch crash log for ${crashId}: ${error.message}`);
  }

  return { crash: normalizeSubmission(submission), logText };
}
