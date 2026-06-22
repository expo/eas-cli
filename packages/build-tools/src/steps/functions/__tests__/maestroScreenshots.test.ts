import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { createMockLogger } from '../../../__tests__/utils/logger';
import {
  type HarvestedScreenshot,
  computePureFailureFlowNames,
  harvestFailureScreenshotsAsync,
  parseFailureScreenshotFilename,
  selectFailureScreenshots,
} from '../maestroScreenshots';

describe(parseFailureScreenshotFilename, () => {
  it('parses a plain failure screenshot', () => {
    expect(parseFailureScreenshotFilename('screenshot-❌-1781186692250-(Login Flow).png')).toEqual({
      flowName: 'Login Flow',
      capturedAtMs: 1781186692250,
    });
  });

  it('parses a sharded failure screenshot', () => {
    expect(
      parseFailureScreenshotFilename('screenshot-shard-2-❌-1781186692250-(Login Flow).png')
    ).toEqual({
      flowName: 'Login Flow',
      capturedAtMs: 1781186692250,
    });
  });

  it('handles parentheses inside the flow name (right-to-left parse)', () => {
    expect(
      parseFailureScreenshotFilename('screenshot-❌-1781186692250-(Login (staging) Flow).png')
    ).toEqual({
      flowName: 'Login (staging) Flow',
      capturedAtMs: 1781186692250,
    });
  });

  it('rejects non-failure screenshots (✅, ⚠️) and unrelated files', () => {
    expect(
      parseFailureScreenshotFilename('screenshot-✅-1781186692250-(Login Flow).png')
    ).toBeNull();
    expect(parseFailureScreenshotFilename('commands-(Login Flow).json')).toBeNull();
    expect(parseFailureScreenshotFilename('android-maestro-junit-attempt-0.xml')).toBeNull();
  });
});

describe(harvestFailureScreenshotsAsync, () => {
  const logger = createMockLogger();
  let testsDirectory: string;

  beforeEach(async () => {
    testsDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'maestro-harvest-test-'));
  });

  afterEach(async () => {
    await fs.rm(testsDirectory, { recursive: true, force: true });
  });

  async function makeDebugDir(name: string, files: string[], mtimeMs: number): Promise<void> {
    const dir = path.join(testsDirectory, name);
    await fs.mkdir(dir);
    for (const file of files) {
      await fs.writeFile(path.join(dir, file), '');
    }
    const when = new Date(mtimeMs);
    await fs.utimes(dir, when, when);
  }

  it('returns shots from dirs modified at/after sinceMtimeMs, attributed to the attempt', async () => {
    const sinceMtimeMs = 1_000_000;
    await makeDebugDir(
      'attempt-dir',
      ['screenshot-❌-1781186692250-(Login Flow).png', 'commands.json'],
      sinceMtimeMs + 5_000
    );

    const shots = await harvestFailureScreenshotsAsync({
      testsDirectory,
      capturedSinceMs: sinceMtimeMs,
      attemptIndex: 1,
      logger,
    });

    expect(shots).toEqual([
      {
        fileAbsPath: path.join(
          testsDirectory,
          'attempt-dir',
          'screenshot-❌-1781186692250-(Login Flow).png'
        ),
        displayName: 'Failure Screenshot: Login Flow (attempt 2)',
        metadata: {
          kind: 'maestro-test-screenshot',
          flowName: 'Login Flow',
          attemptIndex: 1,
          capturedAtMs: 1781186692250,
        },
      },
    ]);
  });

  it('ignores dirs older than sinceMtimeMs (previous attempts)', async () => {
    const sinceMtimeMs = 1_000_000;
    await makeDebugDir(
      'old-dir',
      ['screenshot-❌-1781186692250-(Old Flow).png'],
      sinceMtimeMs - 5_000
    );

    const shots = await harvestFailureScreenshotsAsync({
      testsDirectory,
      capturedSinceMs: sinceMtimeMs,
      attemptIndex: 0,
      logger,
    });

    expect(shots).toEqual([]);
  });

  it('scans multiple new dirs (maestro <2.5.0 split-dir bug)', async () => {
    const sinceMtimeMs = 1_000_000;
    await makeDebugDir(
      'dir-a',
      [`screenshot-❌-${sinceMtimeMs + 100}-(Flow A).png`],
      sinceMtimeMs + 1_000
    );
    await makeDebugDir(
      'dir-b',
      [`screenshot-❌-${sinceMtimeMs + 200}-(Flow B).png`],
      sinceMtimeMs + 2_000
    );

    const shots = await harvestFailureScreenshotsAsync({
      testsDirectory,
      capturedSinceMs: sinceMtimeMs,
      attemptIndex: 0,
      logger,
    });

    expect(shots.map(shot => shot.metadata.flowName).sort()).toEqual(['Flow A', 'Flow B']);
  });

  it('keeps the disk flow name (slashes already substituted) and strips the shard prefix', async () => {
    const sinceMtimeMs = 1_000_000;
    await makeDebugDir(
      'sharded-dir',
      ['screenshot-shard-3-❌-1781186692250-(Login_Sub Flow).png'],
      sinceMtimeMs + 1_000
    );

    const shots = await harvestFailureScreenshotsAsync({
      testsDirectory,
      capturedSinceMs: sinceMtimeMs,
      attemptIndex: 0,
      logger,
    });

    expect(shots).toHaveLength(1);
    expect(shots[0].metadata.flowName).toBe('Login_Sub Flow');
  });

  it('ignores a stale screenshot whose capturedAtMs predates sinceMtimeMs (dir touched later)', async () => {
    const sinceMtimeMs = 1_000_000;
    // The dir mtime is AFTER this attempt started (so it passes the dir gate), but the
    // screenshot inside was captured BEFORE it — a prior attempt's shot in a dir touched later.
    await makeDebugDir(
      'touched-dir',
      ['screenshot-❌-999000-(Stale Flow).png'],
      sinceMtimeMs + 5_000
    );

    const shots = await harvestFailureScreenshotsAsync({
      testsDirectory,
      capturedSinceMs: sinceMtimeMs,
      attemptIndex: 1,
      logger,
    });

    expect(shots).toEqual([]);
  });

  it('logs and returns [] when the tests dir cannot be read', async () => {
    const shots = await harvestFailureScreenshotsAsync({
      testsDirectory: path.join(testsDirectory, 'does-not-exist'),
      capturedSinceMs: 0,
      attemptIndex: 0,
      logger,
    });

    expect(shots).toEqual([]);
  });
});

describe(computePureFailureFlowNames, () => {
  it('classifies a flow that failed every attempt as pure', () => {
    const pure = computePureFailureFlowNames([
      { name: 'Login Flow', status: 'failed' },
      { name: 'Login Flow', status: 'failed' },
    ]);
    expect([...pure]).toEqual(['Login Flow']);
  });

  it('excludes a flaky flow (failed then passed)', () => {
    const pure = computePureFailureFlowNames([
      { name: 'Flaky Flow', status: 'failed' },
      { name: 'Flaky Flow', status: 'passed' },
    ]);
    expect(pure.size).toBe(0);
  });

  it('excludes a fail-pass-fail flow (it passed at some point)', () => {
    const pure = computePureFailureFlowNames([
      { name: 'FPF', status: 'failed' },
      { name: 'FPF', status: 'passed' },
      { name: 'FPF', status: 'failed' },
    ]);
    expect(pure.size).toBe(0);
  });

  it('excludes a flow that only passed', () => {
    expect(computePureFailureFlowNames([{ name: 'Happy', status: 'passed' }]).size).toBe(0);
  });

  it('normalizes the JUnit name to the screenshot form (/ -> _)', () => {
    const pure = computePureFailureFlowNames([{ name: 'sub/Login', status: 'failed' }]);
    expect([...pure]).toEqual(['sub_Login']);
  });

  it('excludes flows that collide only after / -> _ normalization (one failed, one passed)', () => {
    const pure = computePureFailureFlowNames([
      { name: 'sub/Login', status: 'failed' },
      { name: 'sub_Login', status: 'passed' },
    ]);
    expect(pure.size).toBe(0);
  });

  it('returns an empty set for no testcases', () => {
    expect(computePureFailureFlowNames([]).size).toBe(0);
  });
});

describe(selectFailureScreenshots, () => {
  function makeShot(flowName: string, attemptIndex: number): HarvestedScreenshot {
    return {
      fileAbsPath: `/tmp/${flowName}-${attemptIndex}.png`,
      displayName: `Failure Screenshot: ${flowName} (attempt ${attemptIndex + 1})`,
      metadata: {
        kind: 'maestro-test-screenshot',
        flowName,
        attemptIndex,
        capturedAtMs: 1_000 + attemptIndex,
      },
    };
  }

  it('keeps only the final attempt for a pure-failure flow', () => {
    const shots = [makeShot('Pure', 0), makeShot('Pure', 1), makeShot('Pure', 2)];
    const selected = selectFailureScreenshots(shots, new Set(['Pure']));
    expect(selected.map(shot => shot.metadata.attemptIndex)).toEqual([2]);
  });

  it('keeps every attempt for a flow not classified pure (flaky)', () => {
    const shots = [makeShot('Flaky', 0), makeShot('Flaky', 1)];
    const selected = selectFailureScreenshots(shots, new Set());
    expect(selected.map(shot => shot.metadata.attemptIndex)).toEqual([0, 1]);
  });

  it('reduces pure flows while preserving flaky flows and input order', () => {
    const shots = [
      makeShot('Pure', 0),
      makeShot('Flaky', 0),
      makeShot('Pure', 1),
      makeShot('Flaky', 1),
    ];
    const selected = selectFailureScreenshots(shots, new Set(['Pure']));
    expect(selected.map(shot => `${shot.metadata.flowName}#${shot.metadata.attemptIndex}`)).toEqual(
      ['Flaky#0', 'Pure#1', 'Flaky#1']
    );
  });

  it('keeps all when the pure set is empty', () => {
    const shots = [makeShot('A', 0), makeShot('A', 1)];
    expect(selectFailureScreenshots(shots, new Set())).toHaveLength(2);
  });
});
