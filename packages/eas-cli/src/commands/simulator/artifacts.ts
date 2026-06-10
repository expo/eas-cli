import { Flags } from '@oclif/core';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { DeviceRunSessionQuery } from '../../graphql/queries/DeviceRunSessionQuery';
import Log from '../../log';
import { ora } from '../../ora';
import { DeviceRunSessionArtifact, printArtifactsSummary } from '../../simulator/artifacts';
import {
  EAS_SIMULATOR_SESSION_ID,
  SIMULATOR_DOTENV_FILE_NAME,
  loadSimulatorEnvAsync,
} from '../../simulator/env';
import { downloadFileWithProgressTrackerAsync } from '../../utils/download';
import { formatBytes } from '../../utils/files';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

export default class SimulatorArtifacts extends EasCommand {
  static override hidden = true;
  static override description =
    '[EXPERIMENTAL] list and download artifacts (screenshots and screen recordings) of a remote simulator session on EAS';

  static override flags = {
    id: Flags.string({
      description: `Device run session ID. Defaults to ${SIMULATOR_DOTENV_FILE_NAME}.`,
    }),
    'output-dir': Flags.string({
      description:
        'Directory to download the artifacts to. Defaults to ./eas-simulator-artifacts/<session id>.',
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.ProjectDir,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(SimulatorArtifacts);
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);

    if (jsonFlag) {
      enableJsonOutput();
    }

    const {
      projectDir,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(SimulatorArtifacts, {
      nonInteractive,
    });

    await loadSimulatorEnvAsync(projectDir);
    const sessionId = flags.id || process.env[EAS_SIMULATOR_SESSION_ID];
    if (!sessionId) {
      throw new Error(
        `No simulator session ID provided. Pass --id, or run \`eas simulator:start\` first to write ${SIMULATOR_DOTENV_FILE_NAME}.`
      );
    }

    const fetchSpinner = ora(`Fetching artifacts of device run session ${sessionId}`).start();
    let session;
    try {
      session = await DeviceRunSessionQuery.byIdAsync(graphqlClient, sessionId);
    } catch (err) {
      fetchSpinner.fail(`Failed to fetch device run session ${sessionId}`);
      throw err;
    }

    const artifacts = session.turtleJobRun?.artifacts ?? [];
    if (artifacts.length === 0) {
      fetchSpinner.succeed(`Device run session ${sessionId} has no artifacts`);
      if (jsonFlag) {
        printJsonOnlyOutput({ id: session.id, artifacts: [] });
        return;
      }
      Log.log(
        'No artifacts were saved for this session. ' +
          'Screenshots and screen recordings taken with agent-device are saved when the session is stopped — ' +
          'if the session is still running, stop it first and try again in a moment.'
      );
      return;
    }

    fetchSpinner.succeed(
      `Found ${artifacts.length} artifact${artifacts.length === 1 ? '' : 's'} for device run session ${sessionId}`
    );
    if (!jsonFlag) {
      printArtifactsSummary(artifacts);
    }

    const outputDir = path.resolve(
      flags['output-dir'] ?? path.join('eas-simulator-artifacts', sessionId)
    );
    await fs.ensureDir(outputDir);

    const downloaded: { id: string; name: string; path: string }[] = [];
    const failed: { id: string; name: string }[] = [];
    const usedFileNames = new Set<string>();
    for (const artifact of artifacts) {
      if (!artifact.downloadUrl) {
        Log.warn(`Artifact ${artifact.name} has no download URL — skipping.`);
        failed.push({ id: artifact.id, name: artifact.name });
        continue;
      }
      const outputPath = path.join(outputDir, resolveUniqueFileName(usedFileNames, artifact));
      try {
        await downloadFileWithProgressTrackerAsync(
          artifact.downloadUrl,
          outputPath,
          (ratio, total) =>
            `Downloading ${artifact.filename} (${formatBytes(total * ratio)} / ${formatBytes(
              total
            )})`,
          `Downloaded ${artifact.filename}`
        );
        downloaded.push({ id: artifact.id, name: artifact.name, path: outputPath });
      } catch (err) {
        Log.warn(
          `Failed to download artifact ${artifact.name}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
        failed.push({ id: artifact.id, name: artifact.name });
      }
    }

    if (jsonFlag) {
      printJsonOnlyOutput({
        id: session.id,
        outputDir,
        artifacts: downloaded,
        ...(failed.length > 0 ? { failed } : {}),
      });
      return;
    }

    Log.newLine();
    for (const { name, path: filePath } of downloaded) {
      Log.log(`${name} saved to ${chalk.bold(filePath)}`);
    }
    if (failed.length > 0) {
      Log.warn(
        `Failed to download ${failed.length} artifact${failed.length === 1 ? '' : 's'}. Re-run the command to retry.`
      );
    }
  }
}

function resolveUniqueFileName(
  usedFileNames: Set<string>,
  artifact: DeviceRunSessionArtifact
): string {
  const { name: base, ext } = path.parse(artifact.filename);
  let candidate = artifact.filename;
  for (let i = 1; usedFileNames.has(candidate); i++) {
    candidate = `${base}-${i}${ext}`;
  }
  usedFileNames.add(candidate);
  return candidate;
}
