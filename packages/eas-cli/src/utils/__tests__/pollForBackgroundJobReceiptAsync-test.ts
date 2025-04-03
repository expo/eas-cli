import { instance, mock } from 'ts-mockito';

import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  BackgroundJobReceiptDataFragment,
  BackgroundJobResultType,
  BackgroundJobState,
} from '../../graphql/generated';
import { BackgroundJobReceiptQuery } from '../../graphql/queries/BackgroundJobReceiptQuery';
import { pollForBackgroundJobReceiptAsync } from '../pollForBackgroundJobReceiptAsync';

jest.mock('../../graphql/queries/BackgroundJobReceiptQuery');

describe(pollForBackgroundJobReceiptAsync, () => {
  it('returns successful receipt when polling eventually succeeds', async () => {
    const graphqlClient = instance(mock<ExpoGraphqlClient>());

    const receiptId = '123';

    const backgroundJobReceiptInProgress: BackgroundJobReceiptDataFragment = {
      id: receiptId,
      state: BackgroundJobState.InProgress,
      willRetry: false,
      tries: 0,
      resultType: BackgroundJobResultType.Void,
    } as any;

    const backgroundJobReceiptSuccess: BackgroundJobReceiptDataFragment = {
      id: receiptId,
      state: BackgroundJobState.Success,
      willRetry: false,
      tries: 0,
      resultType: BackgroundJobResultType.Void,
    } as any;

    jest
      .mocked(BackgroundJobReceiptQuery.byIdAsync)
      .mockResolvedValueOnce(backgroundJobReceiptInProgress)
      .mockResolvedValueOnce(backgroundJobReceiptInProgress)
      .mockResolvedValueOnce(backgroundJobReceiptSuccess);

    const result = await pollForBackgroundJobReceiptAsync(
      graphqlClient,
      backgroundJobReceiptInProgress,
      { pollInterval: 100 }
    );

    expect(result).toEqual(backgroundJobReceiptSuccess);
  });

  it('throws error when polling eventually fails', async () => {
    const graphqlClient = instance(mock<ExpoGraphqlClient>());

    const receiptId = '123';

    const backgroundJobReceiptInProgress: BackgroundJobReceiptDataFragment = {
      id: receiptId,
      state: BackgroundJobState.InProgress,
      willRetry: false,
      tries: 0,
      resultType: BackgroundJobResultType.Void,
    } as any;

    const backgroundJobReceiptFailure: BackgroundJobReceiptDataFragment = {
      id: receiptId,
      state: BackgroundJobState.Failure,
      errorMessage: 'Watch out for falling rocks!',
      willRetry: false,
      tries: 0,
      resultType: BackgroundJobResultType.Void,
    } as any;

    jest
      .mocked(BackgroundJobReceiptQuery.byIdAsync)
      .mockResolvedValueOnce(backgroundJobReceiptInProgress)
      .mockResolvedValueOnce(backgroundJobReceiptInProgress)
      .mockResolvedValueOnce(backgroundJobReceiptFailure);

    await expect(
      pollForBackgroundJobReceiptAsync(graphqlClient, backgroundJobReceiptInProgress, {
        pollInterval: 100,
      })
    ).rejects.toThrow('Background job failed with error: Watch out for falling rocks!');
  });

  it('succeeds when polling eventually succeeds after a failure with retry', async () => {
    const graphqlClient = instance(mock<ExpoGraphqlClient>());

    const receiptId = '123';

    const backgroundJobReceiptInProgress: BackgroundJobReceiptDataFragment = {
      id: receiptId,
      state: BackgroundJobState.InProgress,
      willRetry: false,
      tries: 0,
      resultType: BackgroundJobResultType.Void,
    } as any;

    const backgroundJobReceiptFailureWithRetry: BackgroundJobReceiptDataFragment = {
      id: receiptId,
      state: BackgroundJobState.Failure,
      errorMessage: 'Watch out for falling rocks!',
      willRetry: true,
      tries: 0,
      resultType: BackgroundJobResultType.Void,
    } as any;

    const backgroundJobReceiptInProgress2: BackgroundJobReceiptDataFragment = {
      id: receiptId,
      state: BackgroundJobState.InProgress,
      willRetry: true,
      tries: 1,
      resultType: BackgroundJobResultType.Void,
    } as any;

    const backgroundJobReceiptSuccess: BackgroundJobReceiptDataFragment = {
      id: receiptId,
      state: BackgroundJobState.Success,
      willRetry: true,
      tries: 1,
      resultType: BackgroundJobResultType.Void,
    } as any;

    jest
      .mocked(BackgroundJobReceiptQuery.byIdAsync)
      .mockResolvedValueOnce(backgroundJobReceiptInProgress)
      .mockResolvedValueOnce(backgroundJobReceiptInProgress)
      .mockResolvedValueOnce(backgroundJobReceiptFailureWithRetry)
      .mockResolvedValueOnce(backgroundJobReceiptInProgress2)
      .mockResolvedValueOnce(backgroundJobReceiptSuccess);

    const result = await pollForBackgroundJobReceiptAsync(
      graphqlClient,
      backgroundJobReceiptInProgress,
      { pollInterval: 100 }
    );

    expect(result).toEqual(backgroundJobReceiptSuccess);
  });

  it('times out after 90 checks', async () => {
    const graphqlClient = instance(mock<ExpoGraphqlClient>());

    const receiptId = '123';

    const backgroundJobReceiptInProgress: BackgroundJobReceiptDataFragment = {
      id: receiptId,
      state: BackgroundJobState.InProgress,
      willRetry: false,
      tries: 0,
      resultType: BackgroundJobResultType.Void,
    } as any;

    jest
      .mocked(BackgroundJobReceiptQuery.byIdAsync)
      .mockResolvedValue(backgroundJobReceiptInProgress);

    await expect(
      pollForBackgroundJobReceiptAsync(graphqlClient, backgroundJobReceiptInProgress, {
        pollInterval: 10,
      })
    ).rejects.toThrow('Background job timed out.');
  });
});
