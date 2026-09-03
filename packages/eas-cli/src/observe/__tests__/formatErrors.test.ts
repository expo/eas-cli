import { AppObserveErrorGroup } from '../../graphql/generated';
import { buildObserveErrorGroupsJson, buildObserveErrorGroupsTable } from '../formatErrors';

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

describe(buildObserveErrorGroupsTable, () => {
  it('renders a placeholder when there are no error groups', () => {
    expect(buildObserveErrorGroupsTable([])).toContain('No errors found');
  });

  it('renders the exception type, message, and counts', () => {
    const output = buildObserveErrorGroupsTable([makeErrorGroup()]);
    expect(output).toContain('TypeError');
    expect(output).toContain('undefined is not a function');
    expect(output).toContain('42');
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
