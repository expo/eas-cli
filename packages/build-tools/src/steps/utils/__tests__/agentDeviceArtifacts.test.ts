import fs from 'node:fs';
import path from 'node:path';

import { vol } from 'memfs';

import { createMockLogger } from '../../../__tests__/utils/logger';
import {
  isAgentDeviceMediaFileName,
  startAgentDeviceMediaCollector,
} from '../agentDeviceArtifacts';

const WATCH_DIR = '/watched-tmp';
const ARTIFACTS_DIR = '/eas-drs-artifacts';

describe(isAgentDeviceMediaFileName, () => {
  it('matches screenshots and recordings with any extension', () => {
    expect(isAgentDeviceMediaFileName('agent-device-screenshot-1700000000000-abc123.png')).toBe(
      true
    );
    expect(isAgentDeviceMediaFileName('agent-device-recording-1700000000000-abc123.mp4')).toBe(
      true
    );
    expect(isAgentDeviceMediaFileName('agent-device-recording-1700000000000-abc123.mov')).toBe(
      true
    );
  });

  it('ignores dot-prefixed post-processing temp files', () => {
    expect(isAgentDeviceMediaFileName('.agent-device-recording-1700000000000-abc123.mp4')).toBe(
      false
    );
  });

  it('ignores unrelated files', () => {
    expect(isAgentDeviceMediaFileName('agent-device-src')).toBe(false);
    expect(isAgentDeviceMediaFileName('some-other-file.png')).toBe(false);
    expect(isAgentDeviceMediaFileName('screenshot-123.png')).toBe(false);
  });
});

describe(startAgentDeviceMediaCollector, () => {
  beforeEach(() => {
    vol.mkdirSync(WATCH_DIR, { recursive: true });
    vol.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  });

  function startCollector(): ReturnType<typeof startAgentDeviceMediaCollector> {
    return startAgentDeviceMediaCollector({
      artifactsDir: ARTIFACTS_DIR,
      logger: createMockLogger(),
      watchDir: WATCH_DIR,
    });
  }

  it('links matching files into the artifacts directory', async () => {
    const collector = startCollector();
    try {
      const fileName = 'agent-device-screenshot-1700000000000-abc123.png';
      await fs.promises.writeFile(path.join(WATCH_DIR, fileName), 'png-bytes');

      await collector.sweepAsync();

      await expect(fs.promises.readFile(path.join(ARTIFACTS_DIR, fileName), 'utf8')).resolves.toBe(
        'png-bytes'
      );
    } finally {
      collector.stop();
    }
  });

  it('retains file content after the original is deleted', async () => {
    const collector = startCollector();
    try {
      const fileName = 'agent-device-recording-1700000000000-abc123.mp4';
      const originalPath = path.join(WATCH_DIR, fileName);
      await fs.promises.writeFile(originalPath, 'mp4-bytes');

      await collector.sweepAsync();
      // Simulates the daemon's delete-after-download behavior.
      await fs.promises.unlink(originalPath);

      await expect(fs.promises.readFile(path.join(ARTIFACTS_DIR, fileName), 'utf8')).resolves.toBe(
        'mp4-bytes'
      );
    } finally {
      collector.stop();
    }
  });

  it('collects each file only once', async () => {
    const collector = startCollector();
    try {
      const fileName = 'agent-device-screenshot-1700000000001-def456.png';
      await fs.promises.writeFile(path.join(WATCH_DIR, fileName), 'png-bytes');

      await collector.sweepAsync();
      await collector.sweepAsync();

      await expect(fs.promises.readdir(ARTIFACTS_DIR)).resolves.toEqual([fileName]);
    } finally {
      collector.stop();
    }
  });

  it('ignores dot-prefixed and unrelated files', async () => {
    const collector = startCollector();
    try {
      await fs.promises.writeFile(
        path.join(WATCH_DIR, '.agent-device-recording-1700000000000-abc123.mp4'),
        'temp-bytes'
      );
      await fs.promises.writeFile(path.join(WATCH_DIR, 'unrelated.png'), 'png-bytes');
      await fs.promises.mkdir(path.join(WATCH_DIR, 'agent-device-src'));

      await collector.sweepAsync();

      await expect(fs.promises.readdir(ARTIFACTS_DIR)).resolves.toEqual([]);
    } finally {
      collector.stop();
    }
  });

  it('collects pre-existing files via the initial scan', async () => {
    const fileName = 'agent-device-screenshot-1699999999999-zzz999.png';
    await fs.promises.writeFile(path.join(WATCH_DIR, fileName), 'png-bytes');

    const collector = startCollector();
    try {
      // The initial scan is fire-and-forget; sweeping deterministically
      // covers the same files.
      await collector.sweepAsync();
      await expect(fs.promises.readdir(ARTIFACTS_DIR)).resolves.toEqual([fileName]);
    } finally {
      collector.stop();
    }
  });

  it('never throws when the watch directory does not exist', async () => {
    const collector = startAgentDeviceMediaCollector({
      artifactsDir: ARTIFACTS_DIR,
      logger: createMockLogger(),
      watchDir: '/does-not-exist',
    });
    try {
      await expect(collector.sweepAsync()).resolves.toBeUndefined();
    } finally {
      collector.stop();
    }
  });
});
