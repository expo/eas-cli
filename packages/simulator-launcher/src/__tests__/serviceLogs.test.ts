import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { commands } from '../utils/processes';

it('writes service output to a private file without sharing the launcher console', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'launcher-service-log-'));
  const logPath = path.join(directory, 'logs', 'service.log');
  try {
    const child = commands.start('/bin/echo', ['service-marker'], { logPath });
    expect(child.child.stdout).toBeNull();
    expect(child.child.stderr).toBeNull();
    await child.resultPromise;
    expect(await fs.readFile(logPath, 'utf8')).toBe('service-marker\n');
    expect((await fs.stat(logPath)).mode & 0o777).toBe(0o600);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
