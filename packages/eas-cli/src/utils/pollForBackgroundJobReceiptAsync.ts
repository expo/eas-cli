import { CombinedError } from '@urql/core';
import { clearIntervalAsync, setIntervalAsync } from 'set-interval-async';

import { ExpoGraphqlClient } from '../commandUtils/context/contextUtils/createGraphqlClient';
import { BackgroundJobReceiptDataFragment, BackgroundJobState } from '../graphql/generated';
import { BackgroundJobReceiptQuery } from '../graphql/queries/BackgroundJobReceiptQuery';

export enum BackgroundJobReceiptPollErrorType {
  NULL_RECEIPT,
  JOB_FAILED_NO_WILL_RETRY,
  TIMEOUT,
}

export type BackgroundJobReceiptPollErrorData =
  | {
      errorType: BackgroundJobReceiptPollErrorType.NULL_RECEIPT;
    }
  | {
      errorType: BackgroundJobReceiptPollErrorType.JOB_FAILED_NO_WILL_RETRY;
      receiptErrorMessage: string | undefined | null;
    }
  | {
      errorType: BackgroundJobReceiptPollErrorType.TIMEOUT;
    };

export class BackgroundJobReceiptPollError extends Error {
  readonly errorData: BackgroundJobReceiptPollErrorData;

  constructor(errorData: BackgroundJobReceiptPollErrorData) {
    super(BackgroundJobReceiptPollError.createErrorMessage(errorData));
    this.errorData = errorData;
  }

  static createErrorMessage(errorData: BackgroundJobReceiptPollErrorData): string {
    switch (errorData.errorType) {
      case BackgroundJobReceiptPollErrorType.NULL_RECEIPT:
        return 'Background job receipt was null.';
      case BackgroundJobReceiptPollErrorType.JOB_FAILED_NO_WILL_RETRY:
        return `Background job failed with error: ${errorData.receiptErrorMessage}`;
      case BackgroundJobReceiptPollErrorType.TIMEOUT:
        return 'Background job timed out.';
    }
  }
}

export type BackgroundJobPollErrorCondition = (error: CombinedError) => {
  errorIndicatesSuccess: boolean;
};

async function fetchBackgroundJobReceiptAsync(
  graphqlClient: ExpoGraphqlClient,
  receiptId: string
): Promise<[BackgroundJobReceiptDataFragment | null, CombinedError | null]> {
  try {
    return [await BackgroundJobReceiptQuery.byIdAsync(graphqlClient, receiptId), null];
  } catch (error) {
    if (error instanceof CombinedError) {
      return [null, error];
    }
    throw error;
  }
}

export function pollForBackgroundJobReceiptAsync(
  graphqlClient: ExpoGraphqlClient,
  backgroundJobReceipt: BackgroundJobReceiptDataFragment
): Promise<BackgroundJobReceiptDataFragment>;
export function pollForBackgroundJobReceiptAsync(
  graphqlClient: ExpoGraphqlClient,
  backgroundJobReceipt: BackgroundJobReceiptDataFragment,
  options?: {
    onBackgroundJobReceiptPollError?: BackgroundJobPollErrorCondition;
    pollInterval?: number;
  }
): Promise<BackgroundJobReceiptDataFragment | null>;
export async function pollForBackgroundJobReceiptAsync(
  graphqlClient: ExpoGraphqlClient,
  backgroundJobReceipt: BackgroundJobReceiptDataFragment,
  options?: {
    onBackgroundJobReceiptPollError?: BackgroundJobPollErrorCondition;
    pollInterval?: number;
  }
): Promise<BackgroundJobReceiptDataFragment | null> {
  return await new Promise<BackgroundJobReceiptDataFragment | null>((resolve, reject) => {
    let numChecks = 0;
    const intervalHandle = setIntervalAsync(async function pollForDeletionFinishedAsync() {
      function failBackgroundDeletion(error: BackgroundJobReceiptPollError): void {
        void clearIntervalAsync(intervalHandle);
        reject(error);
      }

      const [receipt, error] = await fetchBackgroundJobReceiptAsync(
        graphqlClient,
        backgroundJobReceipt.id
      );
      if (!receipt) {
        if (error instanceof CombinedError) {
          const errorResult = options?.onBackgroundJobReceiptPollError?.(error);
          if (errorResult?.errorIndicatesSuccess) {
            void clearIntervalAsync(intervalHandle);
            resolve(null);
            return;
          }
        }
        failBackgroundDeletion(
          new BackgroundJobReceiptPollError({
            errorType: BackgroundJobReceiptPollErrorType.NULL_RECEIPT,
          })
        );
        return;
      }

      // job failed and will not retry
      if (receipt.state === BackgroundJobState.Failure && !receipt.willRetry) {
        failBackgroundDeletion(
          new BackgroundJobReceiptPollError({
            errorType: BackgroundJobReceiptPollErrorType.JOB_FAILED_NO_WILL_RETRY,
            receiptErrorMessage: receipt.errorMessage,
          })
        );
        return;
      }

      // all else fails, stop polling after 90 checks. This should only happen if there's an
      // issue with receipts not setting `willRetry` to false when they fail within a reasonable
      // amount of time.
      if (numChecks > 90) {
        failBackgroundDeletion(
          new BackgroundJobReceiptPollError({
            errorType: BackgroundJobReceiptPollErrorType.TIMEOUT,
          })
        );
        return;
      }

      if (receipt.state === BackgroundJobState.Success) {
        void clearIntervalAsync(intervalHandle);
        resolve(receipt);
        return;
      }

      numChecks++;
    }, options?.pollInterval ?? 1000);
  });
}
