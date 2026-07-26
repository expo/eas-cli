import { App } from '@expo/apple-utils';
import chalk from 'chalk';

import {
  TestFlightCrash,
  TestFlightFeedback,
  TestFlightQuery,
  TestFlightSubmission,
  fetchTestFlightCrashAsync,
  fetchTestFlightFeedbackAsync,
  getTestFlightCrashesQuery,
  getTestFlightFeedbackQuery,
} from './fetch';
import {
  formatTestFlightCrash,
  formatTestFlightCrashDetails,
  formatTestFlightFeedback,
} from './format';
import { BetaFeedbackTarget } from './target';
import { PaginatedQueryOptions } from '../commandUtils/pagination';
import Log from '../log';
import { printJsonOnlyOutput } from '../utils/json';
import { paginatedQueryWithConfirmPromptAsync } from '../utils/queries';

/** Feedback and crashes render as multi-line blocks, so default to a smaller page than lists do. */
export const TESTFLIGHT_PAGE_SIZE = 20;

type ListRendering<T extends TestFlightSubmission> = {
  /** Key the items are nested under in `--json` output. */
  jsonKey: string;
  formatItem: (item: T, position?: number) => string;
  emptyMessage: (bundleId: string) => string;
  loadMorePrompt: string;
  /** Hint printed after a page when more items exist but interactive paging is unavailable. */
  moreAvailableHint: (shown: number, total: number) => string;
};

const FEEDBACK_RENDERING: ListRendering<TestFlightFeedback> = {
  jsonKey: 'feedback',
  formatItem: formatTestFlightFeedback,
  emptyMessage: bundleId =>
    `No TestFlight feedback has been submitted for ${chalk.bold(bundleId)}.`,
  loadMorePrompt: 'Load more feedback?',
  moreAvailableHint: (shown, total) =>
    `Showing ${shown} of ${total} feedback submissions. Use --offset and --limit to see more.`,
};

const CRASHES_RENDERING: ListRendering<TestFlightCrash> = {
  jsonKey: 'crashes',
  formatItem: formatTestFlightCrash,
  emptyMessage: bundleId => `No TestFlight crashes have been reported for ${chalk.bold(bundleId)}.`,
  loadMorePrompt: 'Load more crashes?',
  moreAvailableHint: (shown, total) =>
    `Showing ${shown} of ${total} crashes. Use --offset and --limit to see more.`,
};

async function listAndRenderAsync<T extends TestFlightSubmission>({
  bundleId,
  query,
  rendering,
  paginatedQueryOptions,
}: {
  bundleId: string;
  query: TestFlightQuery<T>;
  rendering: ListRendering<T>;
  paginatedQueryOptions: PaginatedQueryOptions;
}): Promise<void> {
  const { json, nonInteractive, offset } = paginatedQueryOptions;
  const limit = paginatedQueryOptions.limit ?? TESTFLIGHT_PAGE_SIZE;

  if (json) {
    const [items, total] = await Promise.all([
      query.queryAsync(limit, offset),
      query.getTotalAsync(),
    ]);
    printJsonOnlyOutput({
      [rendering.jsonKey]: items,
      total,
      offset,
      limit,
      hasNextPage: offset + items.length < total,
    });
    return;
  }

  const renderPage = (items: T[], pageOffset: number): void => {
    Log.addNewLineIfNone();
    if (items.length === 0) {
      Log.log(
        pageOffset === 0
          ? rendering.emptyMessage(bundleId)
          : chalk.dim('No items past this offset.')
      );
      return;
    }
    Log.log(
      items.map((item, index) => rendering.formatItem(item, pageOffset + index + 1)).join('\n\n')
    );
  };

  if (nonInteractive) {
    const items = await query.queryAsync(limit, offset);
    renderPage(items, offset);
    const total = await query.getTotalAsync();
    if (offset + items.length < total) {
      Log.newLine();
      Log.log(chalk.dim(rendering.moreAvailableHint(offset + items.length, total)));
    }
    return;
  }

  // `paginatedQueryWithConfirmPromptAsync` renders one page at a time without reporting the offset
  // it used, so track how many items have been rendered to keep the numbering absolute.
  let renderedCount = 0;
  await paginatedQueryWithConfirmPromptAsync({
    limit,
    offset,
    queryToPerform: (pageLimit, pageOffset) => query.queryAsync(pageLimit, pageOffset),
    promptOptions: {
      title: rendering.loadMorePrompt,
      renderListItems: items => {
        renderPage(items, offset + renderedCount);
        renderedCount += items.length;
      },
    },
  });
}

/** List screenshot feedback submitted by TestFlight testers. */
export async function listAndRenderTestFlightFeedbackAsync(
  app: App,
  paginatedQueryOptions: PaginatedQueryOptions
): Promise<void> {
  await listAndRenderAsync({
    bundleId: app.attributes.bundleId,
    query: getTestFlightFeedbackQuery(app),
    rendering: FEEDBACK_RENDERING,
    paginatedQueryOptions,
  });
}

/** List crashes reported by TestFlight testers. */
export async function listAndRenderTestFlightCrashesAsync(
  app: App,
  paginatedQueryOptions: PaginatedQueryOptions
): Promise<void> {
  await listAndRenderAsync({
    bundleId: app.attributes.bundleId,
    query: getTestFlightCrashesQuery(app),
    rendering: CRASHES_RENDERING,
    paginatedQueryOptions,
  });
}

/**
 * Render a single submission identified by an EAS workflow trigger's
 * `app_store_connect.beta_feedback` payload. Crashes are rendered with their full crash log.
 */
export async function viewAndRenderBetaFeedbackAsync(
  app: App,
  target: BetaFeedbackTarget,
  { json }: { json: boolean }
): Promise<void> {
  if (target.type === 'crash') {
    const { crash, logText, logError } = await fetchTestFlightCrashAsync(app, target.id);
    if (json) {
      printJsonOnlyOutput({ crash, logText, logError });
      return;
    }
    Log.addNewLineIfNone();
    Log.log(formatTestFlightCrashDetails(crash, logText, logError));
    return;
  }

  const feedback = await fetchTestFlightFeedbackAsync(app, target.id);
  if (json) {
    printJsonOnlyOutput({ feedback });
    return;
  }
  Log.addNewLineIfNone();
  Log.log(formatTestFlightFeedback(feedback));
}
