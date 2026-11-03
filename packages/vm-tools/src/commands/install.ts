import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { getVmStateDirectory } from '../utils/state';

const LABEL = 'com.expo.vm-tools';

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export async function installStartupDaemonAsync(
  runnerPath: string,
  plistPath: string
): Promise<void> {
  const home = os.homedir();
  const directory = getVmStateDirectory();
  await Promise.all(
    [directory, path.join(home, 'Library/LaunchAgents'), path.join(home, 'Library/Logs')].map(
      filename => fs.mkdir(filename, { recursive: true })
    )
  );
  await fs.copyFile(runnerPath, path.join(directory, 'run'));
  const plist = await fs.readFile(plistPath, 'utf8');
  await fs.writeFile(
    path.join(home, `Library/LaunchAgents/${LABEL}.plist`),
    plist
      .replaceAll('__HOME__', escapeXml(home))
      .replaceAll('__NODE__', escapeXml(process.execPath))
  );
}
