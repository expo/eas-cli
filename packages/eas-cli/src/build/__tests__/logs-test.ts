import { BuildPhase } from '@expo/eas-build-job';
import { v4 as uuid } from 'uuid';

import { groupLogLinesIntoSteps } from '../../commandUtils/logs/parseLogs';
import { JobLogs, RawLogLine } from '../../commandUtils/logs/types';
import {
  AppPlatform,
  BuildFragment,
  BuildPriority,
  BuildStatus,
  RealtimeLogsTargetType,
} from '../../graphql/generated';
import {
  formatActiveBuildText,
  formatActiveBuildsText,
  isBuildCompleted,
  logSourceForBuild,
} from '../logs';

function createBuildFragment(overrides: Partial<BuildFragment> = {}): BuildFragment {
  return {
    id: 'build-id',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    platform: AppPlatform.Android,
    logFiles: [],
    priority: BuildPriority.Normal,
    app: {
      __typename: 'App',
      slug: 'test-project',
      id: uuid(),
      name: 'test-project',
      ownerAccount: {
        __typename: 'Account',
        id: uuid(),
        name: 'test-account',
      },
    },
    status: BuildStatus.InProgress,
    isForIosSimulator: false,
    ...overrides,
  };
}

function phaseLines(phase: string, count: number): RawLogLine[] {
  return Array.from({ length: count }, (_, index) => ({ phase, msg: `line${index}` }));
}

function logsForPhase(phase: string, count: number): JobLogs {
  return groupLogLinesIntoSteps(phaseLines(phase, count));
}

describe(logSourceForBuild, () => {
  it('keys the source by the build id', () => {
    expect(logSourceForBuild(createBuildFragment({ id: 'some-build-id' })).key).toBe(
      'some-build-id'
    );
  });

  it('targets the build itself for realtime logs', () => {
    expect(logSourceForBuild(createBuildFragment({ id: 'some-build-id' })).realtimeTarget).toEqual({
      type: RealtimeLogsTargetType.Build,
      id: 'some-build-id',
    });
  });

  it('is in progress only while the build is in progress', () => {
    expect(
      logSourceForBuild(createBuildFragment({ status: BuildStatus.InProgress })).isInProgress
    ).toBe(true);
    for (const status of [
      BuildStatus.New,
      BuildStatus.InQueue,
      BuildStatus.PendingCancel,
      BuildStatus.Canceled,
      BuildStatus.Errored,
      BuildStatus.Finished,
    ]) {
      expect(logSourceForBuild(createBuildFragment({ status })).isInProgress).toBe(false);
    }
  });

  describe('fetchRawLogLinesAsync', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('parses the first log file of the build', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        text: async () =>
          [
            '{"logId":"1","phase":"INSTALL_DEPENDENCIES","msg":"npm ci"}',
            '{"logId":"2","phase":"INSTALL_DEPENDENCIES","msg":"done"}',
          ].join('\n'),
      });
      global.fetch = fetchMock as unknown as typeof global.fetch;

      const source = logSourceForBuild(
        createBuildFragment({ logFiles: ['https://logs.test/first', 'https://logs.test/second'] })
      );

      await expect(source.fetchRawLogLinesAsync()).resolves.toEqual([
        { logId: '1', phase: 'INSTALL_DEPENDENCIES', msg: 'npm ci' },
        { logId: '2', phase: 'INSTALL_DEPENDENCIES', msg: 'done' },
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith('https://logs.test/first');
    });

    it('returns null when the build has no log file', async () => {
      const fetchMock = jest.fn();
      global.fetch = fetchMock as unknown as typeof global.fetch;

      await expect(
        logSourceForBuild(createBuildFragment({ logFiles: [] })).fetchRawLogLinesAsync()
      ).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});

describe(isBuildCompleted, () => {
  it('reports FINISHED as completed', () => {
    expect(isBuildCompleted(BuildStatus.Finished)).toBe(true);
  });

  it('reports ERRORED as completed', () => {
    expect(isBuildCompleted(BuildStatus.Errored)).toBe(true);
  });

  it('reports CANCELED as completed', () => {
    expect(isBuildCompleted(BuildStatus.Canceled)).toBe(true);
  });

  it('reports NEW as not completed', () => {
    expect(isBuildCompleted(BuildStatus.New)).toBe(false);
  });

  it('reports IN_QUEUE as not completed', () => {
    expect(isBuildCompleted(BuildStatus.InQueue)).toBe(false);
  });

  it('reports IN_PROGRESS as not completed', () => {
    expect(isBuildCompleted(BuildStatus.InProgress)).toBe(false);
  });

  it('reports PENDING_CANCEL as not completed', () => {
    expect(isBuildCompleted(BuildStatus.PendingCancel)).toBe(false);
  });
});

describe(formatActiveBuildText, () => {
  it('returns the base text alone when there are no logs', () => {
    expect(formatActiveBuildText('Build in progress...', new Map())).toBe('Build in progress...');
  });

  it('shows the display name of a raw build phase', () => {
    const output = formatActiveBuildText(
      'Build in progress...',
      logsForPhase(BuildPhase.INSTALL_DEPENDENCIES, 1)
    );

    expect(output).toContain('Current phase');
    expect(output).toContain('Install dependencies');
    expect(output).not.toContain('INSTALL_DEPENDENCIES');
  });

  it('passes a build step display name through untouched', () => {
    const output = formatActiveBuildText(
      'Build in progress...',
      groupLogLinesIntoSteps([
        { buildStepId: 'step-id-1', buildStepDisplayName: 'Run fastlane build', msg: 'line0' },
      ])
    );

    expect(output).toContain('Run fastlane build');
    expect(output).not.toContain('step-id-1');
  });

  it('keeps the base text and five trailing log lines', () => {
    const output = formatActiveBuildText(
      'Build in progress...',
      logsForPhase(BuildPhase.RUN_GRADLEW, 10)
    );

    expect(output.startsWith('Build in progress...\n')).toBe(true);
    expect(output).toContain('line5');
    expect(output).toContain('line9');
    expect(output).not.toContain('line4');
  });
});

describe(formatActiveBuildsText, () => {
  it('returns the base text alone when no build has logs', () => {
    expect(
      formatActiveBuildsText('Waiting for builds to complete.', [
        { build: createBuildFragment(), logs: new Map() },
      ])
    ).toBe('Waiting for builds to complete.');
  });

  it('labels each build with its platform emoji and display name', () => {
    const output = formatActiveBuildsText('Waiting for builds to complete.', [
      {
        build: createBuildFragment({ id: 'android-build', platform: AppPlatform.Android }),
        logs: logsForPhase(BuildPhase.RUN_GRADLEW, 1),
      },
      {
        build: createBuildFragment({ id: 'ios-build', platform: AppPlatform.Ios }),
        logs: logsForPhase(BuildPhase.RUN_FASTLANE, 1),
      },
    ]);

    expect(output).toContain('🤖 Android');
    expect(output).toContain('Run gradlew');
    expect(output).toContain('🍏 iOS');
    expect(output).toContain('Run fastlane');
  });

  it('keeps three trailing log lines per build', () => {
    const output = formatActiveBuildsText('Waiting for builds to complete.', [
      {
        build: createBuildFragment({ id: 'android-build', platform: AppPlatform.Android }),
        logs: logsForPhase(BuildPhase.RUN_GRADLEW, 10),
      },
    ]);

    expect(output).toContain('line7');
    expect(output).toContain('line9');
    expect(output).not.toContain('line6');
  });
});
