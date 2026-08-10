import { CombinedError } from '@urql/core';
import openBrowserAsync from 'better-opn';
import { GraphQLError } from 'graphql';

import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import { SupabaseMutation } from '../../../graphql/mutations/SupabaseMutation';
import { SupabaseQuery } from '../../../graphql/queries/SupabaseQuery';
import {
  SupabaseConnectionData,
  SupabaseOrganizationData,
  SupabaseProjectData,
} from '../../../graphql/types/SupabaseConnection';
import Log from '../../../log';
import { selectAsync } from '../../../prompts';
import {
  BackgroundJobReceiptPollError,
  BackgroundJobReceiptPollErrorType,
  pollForBackgroundJobReceiptAsync,
} from '../../../utils/pollForBackgroundJobReceiptAsync';
import {
  additionalProvisionFailureHint,
  authorizeViaBrowserAsync,
  loadOrganizationsBestEffortAsync,
  pollForConnectionAsync,
  pollProvisionReceiptAsync,
  primaryProvisionFailureHint,
  projectNameSuffixForEnvironments,
  resolveOrganizationAsync,
  resolvePublishableKeyAsync,
  resolveRegionAsync,
  toProvisionPollError,
} from '../provision';

jest.mock('better-opn');
jest.mock('../../../graphql/mutations/SupabaseMutation');
jest.mock('../../../graphql/queries/SupabaseQuery');
jest.mock('../../../prompts');
jest.mock('../../../log');
jest.mock('../../../utils/pollForBackgroundJobReceiptAsync', () => ({
  ...jest.requireActual('../../../utils/pollForBackgroundJobReceiptAsync'),
  pollForBackgroundJobReceiptAsync: jest.fn(),
}));
jest.mock('../../../ora', () => ({
  ora: jest.fn(),
}));

import { ora } from '../../../ora';

function mockOraSpinner(): {
  start: jest.Mock;
  succeed: jest.Mock;
  fail: jest.Mock;
  stop: jest.Mock;
  text: string;
} {
  const spinner = {
    start: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
    stop: jest.fn().mockReturnThis(),
    text: '',
  };
  jest.mocked(ora).mockReturnValue(spinner as never);
  return spinner;
}

function userError(message: string): CombinedError {
  return new CombinedError({
    graphQLErrors: [new GraphQLError(message, { extensions: { errorType: 'USER' } })],
  });
}

function systemError(message: string): CombinedError {
  return new CombinedError({
    graphQLErrors: [new GraphQLError(message, { extensions: { errorType: 'SYSTEM' } })],
  });
}

const connection: SupabaseConnectionData = {
  id: 'conn-1',
  supabaseOrganizationSlug: 'org-slug',
  supabaseOrganizationName: 'Org',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

const project: SupabaseProjectData = {
  id: 'project-1',
  supabaseProjectRef: 'abcdefghijklmnop',
  supabaseProjectName: 'Demo',
  supabaseProjectUrl: 'https://abcdefghijklmnop.supabase.co',
  supabaseRegion: 'us-east-1',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

describe('provision hints and poll errors', () => {
  it('builds failure hints', () => {
    expect(primaryProvisionFailureHint()).toContain('--link');
    const additional = additionalProvisionFailureHint(['preview']);
    expect(additional).toContain('--environment preview');
    expect(additional).not.toContain('--link');
    expect(additional).toContain('EXPO_PUBLIC_SUPABASE_URL');
  });

  it('toProvisionPollError preserves non-poll errors', () => {
    const err = new Error('boom');
    expect(toProvisionPollError(err, { hint: 'hint' })).toBe(err);
    expect(toProvisionPollError('string-err', { hint: '' }).message).toBe('string-err');
  });

  it('toProvisionPollError wraps failed job messages with hints', () => {
    const pollError = new BackgroundJobReceiptPollError({
      errorType: BackgroundJobReceiptPollErrorType.JOB_FAILED_NO_WILL_RETRY,
      receiptErrorMessage: 'quota exceeded',
    });
    expect(toProvisionPollError(pollError, { hint: 'try link' }).message).toContain(
      'quota exceeded'
    );
    expect(toProvisionPollError(pollError, { hint: 'try link' }).message).toContain('try link');

    const noMessage = new BackgroundJobReceiptPollError({
      errorType: BackgroundJobReceiptPollErrorType.JOB_FAILED_NO_WILL_RETRY,
      receiptErrorMessage: null,
    });
    expect(toProvisionPollError(noMessage, { hint: '' }).message).toContain(
      'Background job failed'
    );
  });

  it('toProvisionPollError wraps timeout/null receipt', () => {
    const timeout = new BackgroundJobReceiptPollError({
      errorType: BackgroundJobReceiptPollErrorType.TIMEOUT,
    });
    expect(toProvisionPollError(timeout, { hint: '' }).message).toContain('Timed out');

    const nullReceipt = new BackgroundJobReceiptPollError({
      errorType: BackgroundJobReceiptPollErrorType.NULL_RECEIPT,
    });
    expect(toProvisionPollError(nullReceipt, { hint: 'hint' }).message).toContain('hint');
  });

  it('toProvisionPollError returns unrecognized poll errors unchanged', () => {
    const pollError = new BackgroundJobReceiptPollError({
      errorType: BackgroundJobReceiptPollErrorType.TIMEOUT,
    });
    (pollError as { errorData: { errorType: number } }).errorData = { errorType: 999 };
    expect(toProvisionPollError(pollError, { hint: 'hint' })).toBe(pollError);
  });
});

describe('pollProvisionReceiptAsync', () => {
  const client = {} as ExpoGraphqlClient;
  let spinner: ReturnType<typeof mockOraSpinner>;

  beforeEach(() => {
    jest.resetAllMocks();
    spinner = mockOraSpinner();
  });

  it('returns the finalized receipt and stops its own spinner', async () => {
    const receipt = { id: 'r1' } as never;
    jest.mocked(pollForBackgroundJobReceiptAsync).mockResolvedValue(receipt);

    const result = await pollProvisionReceiptAsync(client, receipt, {
      startMessage: 'start',
      waitingMessage: 'wait',
      failureMessage: 'fail',
      failureHint: 'hint',
    });
    expect(result).toBe(receipt);
    expect(spinner.stop).toHaveBeenCalled();
    expect(spinner.succeed).not.toHaveBeenCalled();
  });

  it('fails spinner when poll returns null', async () => {
    jest.mocked(pollForBackgroundJobReceiptAsync).mockResolvedValue(null);
    await expect(
      pollProvisionReceiptAsync(client, { id: 'r1' } as never, {
        startMessage: 'start',
        waitingMessage: 'wait',
        failureMessage: 'fail',
        failureHint: 'hint',
      })
    ).rejects.toThrow(/without a receipt/);
  });
});

describe('authorizeViaBrowserAsync / loadOrganizationsBestEffortAsync / pollForConnectionAsync', () => {
  const client = {} as ExpoGraphqlClient;
  const account = { id: 'acct-1', name: 'acct' };

  beforeEach(() => {
    jest.resetAllMocks();
    mockOraSpinner();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('authorizeViaBrowserAsync rejects non-interactive mode', async () => {
    await expect(authorizeViaBrowserAsync(client, account, true)).rejects.toThrow(
      /non-interactive/
    );
  });

  it('authorizeViaBrowserAsync polls until connected', async () => {
    jest.mocked(SupabaseMutation.beginSupabaseOAuthAsync).mockResolvedValue({
      url: 'https://oauth.example',
    });
    jest.mocked(openBrowserAsync).mockResolvedValue(true as never);
    jest
      .mocked(SupabaseQuery.getSupabaseConnectionByAccountIdAsync)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(connection);
    jest
      .mocked(SupabaseMutation.listSupabaseOrganizationsAsync)
      .mockResolvedValue([{ id: '1', slug: 'org-slug', name: 'Org' }]);

    const promise = authorizeViaBrowserAsync(client, account, false);
    await jest.advanceTimersByTimeAsync(2_000);
    await expect(promise).resolves.toEqual(connection);
  });

  it('authorizeViaBrowserAsync shows URL when browser open fails', async () => {
    jest.mocked(SupabaseMutation.beginSupabaseOAuthAsync).mockResolvedValue({
      url: 'https://oauth.example',
    });
    jest.mocked(openBrowserAsync).mockRejectedValue(new Error('no browser'));
    jest.mocked(SupabaseQuery.getSupabaseConnectionByAccountIdAsync).mockResolvedValue(connection);
    jest.mocked(SupabaseMutation.listSupabaseOrganizationsAsync).mockResolvedValue([]);

    await expect(authorizeViaBrowserAsync(client, account, false)).resolves.toEqual(connection);
    expect(Log.log).toHaveBeenCalledWith(expect.stringContaining('Open this URL'));
  });

  it('authorizeViaBrowserAsync succeeds when organization listing fails', async () => {
    jest.mocked(SupabaseMutation.beginSupabaseOAuthAsync).mockResolvedValue({
      url: 'https://oauth.example',
    });
    jest.mocked(openBrowserAsync).mockResolvedValue(true as never);
    jest.mocked(SupabaseQuery.getSupabaseConnectionByAccountIdAsync).mockResolvedValue(connection);
    jest
      .mocked(SupabaseMutation.listSupabaseOrganizationsAsync)
      .mockRejectedValue(new Error('org list unavailable'));

    const spinner = mockOraSpinner();
    await expect(authorizeViaBrowserAsync(client, account, false)).resolves.toEqual(connection);
    expect(spinner.succeed).toHaveBeenCalledWith(expect.stringContaining('org-slug'));
  });

  it('authorizeViaBrowserAsync fails spinner on a non-retriable poll error', async () => {
    jest.mocked(SupabaseMutation.beginSupabaseOAuthAsync).mockResolvedValue({
      url: 'https://oauth.example',
    });
    jest.mocked(openBrowserAsync).mockResolvedValue(true as never);
    jest
      .mocked(SupabaseQuery.getSupabaseConnectionByAccountIdAsync)
      .mockRejectedValue(userError('not authorized'));

    const spinner = mockOraSpinner();
    await expect(authorizeViaBrowserAsync(client, account, false)).rejects.toThrow(
      /not authorized/
    );
    expect(spinner.fail).toHaveBeenCalled();
  });

  it('authorizeViaBrowserAsync fails spinner when the authorization never arrives', async () => {
    jest.mocked(SupabaseMutation.beginSupabaseOAuthAsync).mockResolvedValue({
      url: 'https://oauth.example',
    });
    jest.mocked(openBrowserAsync).mockResolvedValue(true as never);
    jest.mocked(SupabaseQuery.getSupabaseConnectionByAccountIdAsync).mockResolvedValue(null);

    const spinner = mockOraSpinner();
    const promise = authorizeViaBrowserAsync(client, account, false);
    promise.catch(() => undefined);
    await jest.advanceTimersByTimeAsync(15 * 60 * 1_000 + 2_000);
    await expect(promise).rejects.toThrow(/Timed out waiting for the Supabase connection/);
    expect(spinner.fail).toHaveBeenCalled();
  });

  it('loadOrganizationsBestEffortAsync returns null on failure', async () => {
    jest
      .mocked(SupabaseMutation.listSupabaseOrganizationsAsync)
      .mockRejectedValue(new Error('nope'));
    await expect(loadOrganizationsBestEffortAsync(client, 'acct-1')).resolves.toBeNull();
  });

  it('pollForConnectionAsync retries after retriable query errors', async () => {
    jest
      .mocked(SupabaseQuery.getSupabaseConnectionByAccountIdAsync)
      .mockRejectedValueOnce(new CombinedError({ networkError: new Error('offline') }))
      .mockResolvedValueOnce(connection);

    const promise = pollForConnectionAsync(client, 'acct-1');
    await jest.advanceTimersByTimeAsync(2_000);
    await expect(promise).resolves.toEqual(connection);
    expect(Log.debug).toHaveBeenCalled();
  });

  it('pollForConnectionAsync stops on a non-retriable query error', async () => {
    jest
      .mocked(SupabaseQuery.getSupabaseConnectionByAccountIdAsync)
      .mockRejectedValue(userError('not authorized'));

    await expect(pollForConnectionAsync(client, 'acct-1')).rejects.toThrow(/not authorized/);
    expect(SupabaseQuery.getSupabaseConnectionByAccountIdAsync).toHaveBeenCalledTimes(1);
  });

  it('pollForConnectionAsync keeps waiting through server-side errors', async () => {
    jest
      .mocked(SupabaseQuery.getSupabaseConnectionByAccountIdAsync)
      .mockRejectedValueOnce(systemError('boom'))
      .mockResolvedValueOnce(connection);

    const promise = pollForConnectionAsync(client, 'acct-1');
    await jest.advanceTimersByTimeAsync(2_000);
    await expect(promise).resolves.toEqual(connection);
  });

  it('pollForConnectionAsync surfaces an error that keeps repeating', async () => {
    jest
      .mocked(SupabaseQuery.getSupabaseConnectionByAccountIdAsync)
      .mockRejectedValue(new CombinedError({ networkError: new Error('offline') }));

    const promise = pollForConnectionAsync(client, 'acct-1');
    promise.catch(() => undefined);
    await jest.advanceTimersByTimeAsync(10 * 2_000);
    await expect(promise).rejects.toThrow(/offline/);
    expect(SupabaseQuery.getSupabaseConnectionByAccountIdAsync).toHaveBeenCalledTimes(10);
  });

  it('pollForConnectionAsync forgives errors that stop repeating', async () => {
    const query = jest.mocked(SupabaseQuery.getSupabaseConnectionByAccountIdAsync);
    for (let i = 0; i < 9; i++) {
      query.mockRejectedValueOnce(new CombinedError({ networkError: new Error('offline') }));
    }
    query.mockResolvedValueOnce(null);
    for (let i = 0; i < 9; i++) {
      query.mockRejectedValueOnce(new CombinedError({ networkError: new Error('offline') }));
    }
    query.mockResolvedValueOnce(connection);

    const promise = pollForConnectionAsync(client, 'acct-1');
    await jest.advanceTimersByTimeAsync(20 * 2_000);
    await expect(promise).resolves.toEqual(connection);
  });
});

describe('resolvePublishableKeyAsync', () => {
  const client = {} as ExpoGraphqlClient;

  beforeEach(() => {
    jest.resetAllMocks();
    mockOraSpinner();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns key once available', async () => {
    jest
      .mocked(SupabaseMutation.fetchSupabasePublishableKeyAsync)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('pk_live');

    const promise = resolvePublishableKeyAsync(client, 'app-1', project);
    await jest.advanceTimersByTimeAsync(3_000);
    await expect(promise).resolves.toBe('pk_live');
  });

  it('stops on a non-retriable readiness error', async () => {
    jest
      .mocked(SupabaseMutation.fetchSupabasePublishableKeyAsync)
      .mockRejectedValue(userError('revoked'));

    await expect(resolvePublishableKeyAsync(client, 'app-1', project)).rejects.toThrow(/revoked/);
    expect(SupabaseMutation.fetchSupabasePublishableKeyAsync).toHaveBeenCalledTimes(1);
  });

  it('keeps waiting through retriable readiness errors', async () => {
    jest
      .mocked(SupabaseMutation.fetchSupabasePublishableKeyAsync)
      .mockRejectedValueOnce(new CombinedError({ networkError: new Error('offline') }))
      .mockResolvedValueOnce('pk_live');

    const promise = resolvePublishableKeyAsync(client, 'app-1', project);
    await jest.advanceTimersByTimeAsync(3_000);
    await expect(promise).resolves.toBe('pk_live');
  });

  it('gives up once a server fault keeps repeating', async () => {
    jest
      .mocked(SupabaseMutation.fetchSupabasePublishableKeyAsync)
      .mockRejectedValue(systemError('upstream 502'));

    const promise = resolvePublishableKeyAsync(client, 'app-1', project);
    promise.catch(() => undefined);
    await jest.advanceTimersByTimeAsync(10 * 3_000);
    await expect(promise).rejects.toThrow(/upstream 502/);
    expect(SupabaseMutation.fetchSupabasePublishableKeyAsync).toHaveBeenCalledTimes(10);
  });

  it('keeps waiting through a server fault that resolves', async () => {
    jest
      .mocked(SupabaseMutation.fetchSupabasePublishableKeyAsync)
      .mockRejectedValueOnce(systemError('upstream 502'))
      .mockResolvedValueOnce('pk_live');

    const promise = resolvePublishableKeyAsync(client, 'app-1', project);
    await jest.advanceTimersByTimeAsync(3_000);
    await expect(promise).resolves.toBe('pk_live');
  });

  it('times out when key never becomes ready', async () => {
    jest.mocked(SupabaseMutation.fetchSupabasePublishableKeyAsync).mockResolvedValue(null);

    const promise = resolvePublishableKeyAsync(client, 'app-1', project);
    promise.catch(() => undefined);
    await jest.advanceTimersByTimeAsync(5 * 60 * 1_000 + 3_000);
    await expect(promise).rejects.toThrow(/still provisioning/);
  });
});

describe('resolveRegionAsync', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('returns flag value when provided', async () => {
    await expect(resolveRegionAsync('emea', true)).resolves.toBe('emea');
  });

  it('rejects a whitespace-only --region value', async () => {
    await expect(resolveRegionAsync('   ', true)).rejects.toThrow(/Pass a Supabase region/);
  });

  it('throws in non-interactive mode without a flag', async () => {
    await expect(resolveRegionAsync(undefined, true)).rejects.toThrow(/--region/);
  });

  it('prompts interactively when unset', async () => {
    jest.mocked(selectAsync).mockResolvedValue('apac');
    await expect(resolveRegionAsync(undefined, false)).resolves.toBe('apac');
  });
});

describe('resolveOrganizationAsync', () => {
  const client = {} as ExpoGraphqlClient;
  const organizations: SupabaseOrganizationData[] = [
    { id: '1', slug: 'org-slug', name: 'Org' },
    { id: '2', slug: 'other', name: 'Other' },
  ];

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('returns connection when flag matches current org', async () => {
    await expect(
      resolveOrganizationAsync(client, 'acct-1', connection, 'org-slug', true, organizations)
    ).resolves.toEqual(connection);
  });

  it('sets organization when flag is a different connected org', async () => {
    const updated = { ...connection, supabaseOrganizationSlug: 'other' };
    jest.mocked(SupabaseMutation.setSupabaseConnectionOrganizationAsync).mockResolvedValue(updated);

    await expect(
      resolveOrganizationAsync(client, 'acct-1', connection, 'other', true, organizations)
    ).resolves.toEqual(updated);
  });

  it('throws when flag org is unknown', async () => {
    await expect(
      resolveOrganizationAsync(client, 'acct-1', connection, 'missing', true, organizations)
    ).rejects.toThrow(/isn't one of your connected organizations/);
  });

  it('returns connection in non-interactive mode without flag', async () => {
    await expect(
      resolveOrganizationAsync(client, 'acct-1', connection, undefined, true, organizations)
    ).resolves.toEqual(connection);
  });

  it('returns connection when only one org exists', async () => {
    await expect(
      resolveOrganizationAsync(client, 'acct-1', connection, undefined, false, [organizations[0]])
    ).resolves.toEqual(connection);
  });

  it('prompts and updates when a different org is chosen', async () => {
    const updated = { ...connection, supabaseOrganizationSlug: 'other' };
    jest.mocked(selectAsync).mockResolvedValue('other');
    jest.mocked(SupabaseMutation.setSupabaseConnectionOrganizationAsync).mockResolvedValue(updated);

    await expect(
      resolveOrganizationAsync(client, 'acct-1', connection, undefined, false, organizations)
    ).resolves.toEqual(updated);
  });

  it('prompts and keeps current org when reselected', async () => {
    jest.mocked(selectAsync).mockResolvedValue('org-slug');
    await expect(
      resolveOrganizationAsync(client, 'acct-1', connection, undefined, false, organizations)
    ).resolves.toEqual(connection);
    expect(SupabaseMutation.setSupabaseConnectionOrganizationAsync).not.toHaveBeenCalled();
  });

  it('loads organizations when not preloaded', async () => {
    jest.mocked(SupabaseMutation.listSupabaseOrganizationsAsync).mockResolvedValue(organizations);
    const updated = { ...connection, supabaseOrganizationSlug: 'other' };
    jest.mocked(SupabaseMutation.setSupabaseConnectionOrganizationAsync).mockResolvedValue(updated);

    await expect(
      resolveOrganizationAsync(client, 'acct-1', connection, 'other', true, null)
    ).resolves.toEqual(updated);
    expect(SupabaseMutation.listSupabaseOrganizationsAsync).toHaveBeenCalled();
  });

  it('loads organizations interactively when not preloaded', async () => {
    jest.mocked(SupabaseMutation.listSupabaseOrganizationsAsync).mockResolvedValue(organizations);
    jest.mocked(selectAsync).mockResolvedValue('org-slug');

    await expect(
      resolveOrganizationAsync(client, 'acct-1', connection, undefined, false, null)
    ).resolves.toEqual(connection);
    expect(SupabaseMutation.listSupabaseOrganizationsAsync).toHaveBeenCalled();
  });
});

describe('projectNameSuffixForEnvironments', () => {
  it('sorts, joins, and truncates environment names', () => {
    expect(projectNameSuffixForEnvironments(['preview', 'development'])).toBe(
      'development-preview'
    );
    expect(
      projectNameSuffixForEnvironments(['a'.repeat(40), 'b'.repeat(40)]).length
    ).toBeLessThanOrEqual(32);
  });

  it('replaces characters outside [a-zA-Z0-9._-] with a dash', () => {
    expect(projectNameSuffixForEnvironments(['a/b', 'c d'])).toBe('a-b-c-d');
  });
});
