import { AppObserveError, AppObserveErrorGroup, PageInfo } from '../../graphql/generated';
import {
  buildObserveErrorGroupsJson,
  buildObserveErrorGroupsTable,
  buildObserveErrorOccurrencesJson,
  buildObserveErrorOccurrencesTable,
} from '../formatErrors';

function makeErrorGroup(overrides: Partial<AppObserveErrorGroup> = {}): AppObserveErrorGroup {
  return {
    __typename: 'AppObserveErrorGroup' as const,
    fingerprint: 'fp-1',
    exceptionType: 'TypeError',
    exceptionMessage: 'undefined is not a function',
    errorSource: 'js',
    severity: 'FATAL',
    isFatal: true,
    eventCount: 42,
    uniqueUserCount: 10,
    affectedSessionCount: 8,
    firstSeenAt: '2025-01-01T00:00:00.000Z',
    lastSeenAt: '2025-01-15T00:00:00.000Z',
    platforms: ['IOS'],
    ...overrides,
  } as AppObserveErrorGroup;
}

function makeErrorOccurrence(overrides: Partial<AppObserveError> = {}): AppObserveError {
  return {
    __typename: 'AppObserveError' as const,
    id: 'err-1',
    type: 'TypeError',
    message: 'undefined is not a function',
    source: 'js',
    fingerprint: 'fp-1',
    severityText: 'fatal',
    severityNumber: null,
    isFatal: true,
    stacktrace: 'at foo (app.js:1:1)\nat bar (app.js:2:2)',
    body: null,
    timestamp: '2025-01-15T10:00:00.000Z',
    sessionId: 'session-1',
    appVersion: '1.0.0',
    appBuildNumber: '42',
    appUpdateId: null,
    appEasBuildId: null,
    deviceModel: 'iPhone 15',
    deviceOs: 'iOS',
    deviceOsVersion: '17.0',
    environment: 'production',
    easClientId: 'client-1',
    countryCode: 'US',
    properties: [],
    ...overrides,
  } as AppObserveError;
}

const noNextPage = {
  __typename: 'PageInfo' as const,
  hasNextPage: false,
  hasPreviousPage: false,
  endCursor: null,
} as PageInfo;

describe(buildObserveErrorGroupsTable, () => {
  it('renders a placeholder when there are no error groups', () => {
    expect(buildObserveErrorGroupsTable([])).toContain('No errors found');
  });

  it('renders the fingerprint, exception type, message, and counts', () => {
    const output = buildObserveErrorGroupsTable([makeErrorGroup()]);
    expect(output).toContain('fp-1');
    expect(output).toContain('TypeError');
    expect(output).toContain('undefined is not a function');
    expect(output).toContain('42');
    expect(output).toContain('--fingerprint');
  });
});

describe(buildObserveErrorOccurrencesTable, () => {
  it('renders a placeholder when there are no occurrences', () => {
    const output = buildObserveErrorOccurrencesTable([], noNextPage, { fingerprint: 'fp-1' });
    expect(output).toContain('No occurrences found');
    expect(output).toContain('fp-1');
  });

  it('renders occurrence details including the stack trace', () => {
    const output = buildObserveErrorOccurrencesTable([makeErrorOccurrence()], noNextPage, {
      fingerprint: 'fp-1',
    });
    expect(output).toContain('Stack trace');
    expect(output).toContain('at foo (app.js:1:1)');
    expect(output).toContain('TypeError');
  });
});

describe(buildObserveErrorOccurrencesJson, () => {
  it('includes the stack trace and properties in the JSON', () => {
    const result = buildObserveErrorOccurrencesJson([makeErrorOccurrence()], noNextPage);
    expect(result.occurrences[0].stacktrace).toBe('at foo (app.js:1:1)\nat bar (app.js:2:2)');
    expect(result.occurrences[0].id).toBe('err-1');
    expect(result.pageInfo).toEqual({ hasNextPage: false, endCursor: null });
  });
});

describe(buildObserveErrorGroupsJson, () => {
  it('maps error-group fields into stable JSON keys', () => {
    const result = buildObserveErrorGroupsJson([makeErrorGroup()], false);
    expect(result).toEqual({
      isTruncated: false,
      errors: [
        {
          fingerprint: 'fp-1',
          type: 'TypeError',
          message: 'undefined is not a function',
          source: 'js',
          severity: 'FATAL',
          isFatal: true,
          eventCount: 42,
          uniqueUserCount: 10,
          affectedSessionCount: 8,
          firstSeenAt: '2025-01-01T00:00:00.000Z',
          lastSeenAt: '2025-01-15T00:00:00.000Z',
          platforms: ['IOS'],
        },
      ],
    });
  });
});
