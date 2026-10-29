import path from 'node:path';

import { downloadSimulatorFileAsync } from './download';
import { stripTerminalControlCharacters } from './utils';
import fetch from '../fetch';
import { DeviceRunSessionByIdQuery, DeviceRunSessionStatus } from '../graphql/generated';
import Log from '../log';
import { ora } from '../ora';
import { formatBytes } from '../utils/files';
import { promptAsync, selectAsync } from '../prompts';
import { printJsonOnlyOutput } from '../utils/json';

export type SimulatorSession = DeviceRunSessionByIdQuery['deviceRunSessions']['byId'];

export function hasSimulatorArtifacts(session: SimulatorSession): boolean {
  return (
    session.status === DeviceRunSessionStatus.Stopped ||
    session.status === DeviceRunSessionStatus.Errored
  );
}

export async function downloadSimulatorArtifactAsync(
  session: SimulatorSession,
  type: string,
  {
    artifact: index,
    output,
    nonInteractive,
    json,
  }: { artifact?: number; output?: string; nonInteractive: boolean; json: boolean }
): Promise<void> {
  const artifacts = session.artifacts
    .filter(artifact => artifact.metadata?.__eas_type === type)
    .sort(
      (a, b) =>
        Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id)
    );
  if (artifacts.length === 0) {
    throw new Error(
      'No matching artifacts are available for this session. Artifacts may still be uploading or may not have been recorded. Run `eas simulator:get` to check the session, then try again.'
    );
  }
  const titles = artifacts.map((artifact, i) => {
    const metadata = artifact.metadata;
    const device = metadata?.deviceName ?? metadata?.udid;
    const part = metadata?.part;
    return stripTerminalControlCharacters(
      `${i + 1}. ${artifact.name} — ${artifact.filename} (${formatBytes(artifact.fileSizeBytes ?? 0)})${device ? ` (${device})` : ''}${part !== undefined ? ` (part ${part})` : ''}`
    );
  });
  const selectionMessage = `Choose an artifact with --artifact <index>:\n${titles.join('\n')}`;
  let selectedIndex = index;
  if (
    selectedIndex !== undefined &&
    (!Number.isInteger(selectedIndex) || selectedIndex < 1 || selectedIndex > artifacts.length)
  ) {
    throw new Error(`The artifact index is out of range. ${selectionMessage}`);
  }
  if (selectedIndex === undefined) {
    if (artifacts.length === 1) {
      selectedIndex = 1;
    } else if (nonInteractive) {
      throw new Error(selectionMessage);
    } else {
      selectedIndex = await selectAsync(
        'Select an artifact to download:',
        titles.map((title, i) => ({ title, value: i + 1 }))
      );
    }
  }
  const artifact = artifacts[selectedIndex - 1];
  if (!output) {
    if (nonInteractive) {
      throw new Error('Pass --output <path> to save the session artifact in non-interactive mode.');
    }
    const { filePath } = await promptAsync({
      type: 'text',
      name: 'filePath',
      message: 'Where should the artifact be saved?',
      initial: stripTerminalControlCharacters(path.basename(artifact.filename)),
      validate: value => value.trim().length > 0 || 'Enter an output path.',
    });
    output = typeof filePath === 'string' ? filePath : undefined;
  }
  if (!output) {
    throw new Error('Enter an output path.');
  }
  const spinner = json ? undefined : ora('Downloading session artifact').start();
  let filePath: string;
  try {
    filePath = await downloadSimulatorFileAsync(output, async signal => {
      try {
        return await fetch(artifact.downloadUrl, { signal, timeout: 30_000 });
      } catch {
        throw new Error(
          'Could not download the session artifact. Check your internet connection and try again.'
        );
      }
    });
    spinner?.succeed();
  } catch (error) {
    spinner?.fail();
    throw error;
  }
  if (json) {
    const { id, name, filename, metadata } = artifact;
    printJsonOnlyOutput({
      deviceRunSessionId: session.id,
      artifact: { id, name, filename, metadata },
      filePath,
    });
  } else {
    Log.log(
      `Saved ${stripTerminalControlCharacters(artifact.name)} to ${stripTerminalControlCharacters(filePath)}.`
    );
  }
}
