import { Flags } from '@oclif/core';

import { getDeviceRunSessionUrl } from '../../build/utils/url';
import EasCommand from '../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { DeviceRunSessionByIdQuery, DeviceRunSessionStatus } from '../../graphql/generated';
import { DeviceRunSessionQuery } from '../../graphql/queries/DeviceRunSessionQuery';
import Log, { link } from '../../log';
import { ora } from '../../ora';
import {
  EAS_SIMULATOR_SESSION_ID,
  SIMULATOR_DOTENV_FILE_NAME,
  loadSimulatorEnvAsync,
} from '../../simulator/env';
import {
  deviceRunSessionTypeToFlagValue,
  formatRemoteSessionInstructions,
} from '../../simulator/utils';
import { formatBytes } from '../../utils/files';
import formatFields, { FormatFieldsItem } from '../../utils/formatFields';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

type DeviceRunSessionById = DeviceRunSessionByIdQuery['deviceRunSessions']['byId'];
type DeviceRunSessionArtifact = DeviceRunSessionById['artifacts'][number];

export default class SimulatorGet extends EasCommand {
  static override hidden = true;
  static override description =
    '[EXPERIMENTAL] get info about a remote simulator session on EAS by its simulator session ID';

  static override flags = {
    id: Flags.string({
      description: `Simulator session ID. Defaults to ${SIMULATOR_DOTENV_FILE_NAME}.`,
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.ProjectDir,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(SimulatorGet);
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);

    if (jsonFlag) {
      enableJsonOutput();
    }

    const {
      projectDir,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(SimulatorGet, {
      nonInteractive,
    });

    await loadSimulatorEnvAsync(projectDir);
    const flagId = flags.id || process.env[EAS_SIMULATOR_SESSION_ID];
    if (!flagId) {
      throw new Error(
        `No simulator session ID provided. Pass --id, or run \`eas simulator:start\` first to write ${SIMULATOR_DOTENV_FILE_NAME}.`
      );
    }

    const fetchSpinner = ora(`Fetching simulator session ${flagId}`).start();
    let session: DeviceRunSessionById;
    try {
      session = await DeviceRunSessionQuery.byIdAsync(graphqlClient, flagId);
      fetchSpinner.succeed(`Fetched simulator session ${session.id}`);
    } catch (err) {
      fetchSpinner.fail(`Failed to fetch simulator session ${flagId}`);
      throw err;
    }

    const deviceRunSessionUrl = getDeviceRunSessionUrl(
      session.app.ownerAccount.name,
      session.app.slug,
      session.id
    );

    if (jsonFlag) {
      printJsonOnlyOutput({
        id: session.id,
        type: deviceRunSessionTypeToFlagValue(session.type),
        status: session.status,
        platform: session.platform,
        createdAt: session.createdAt,
        startedAt: session.startedAt ?? undefined,
        finishedAt: session.finishedAt ?? undefined,
        updatedAt: session.updatedAt,
        deviceRunSessionUrl,
        remoteConfig: session.remoteConfig,
        artifacts: session.artifacts,
      });
      return;
    }

    Log.newLine();
    Log.log(formatSessionFields(session, deviceRunSessionUrl));

    if (session.status === DeviceRunSessionStatus.InProgress) {
      Log.newLine();
      if (session.remoteConfig) {
        Log.log(formatRemoteSessionInstructions(session.remoteConfig, 'env'));
      } else {
        Log.log(
          '⏳ Session is starting up — remote config is not available yet. Re-run this command in a moment.'
        );
      }
    }

    printArtifacts('Session artifacts', session.artifacts, formatDeviceRunSessionArtifactFields);
  }
}

function formatSessionFields(session: DeviceRunSessionById, deviceRunSessionUrl: string): string {
  return formatFields([
    { label: 'ID', value: session.id },
    { label: 'Type', value: session.type },
    { label: 'Status', value: session.status },
    { label: 'Platform', value: session.platform },
    { label: 'Created at', value: String(session.createdAt) },
    { label: 'Started at', value: formatNullable(session.startedAt) },
    { label: 'Finished at', value: formatNullable(session.finishedAt) },
    { label: 'Updated at', value: String(session.updatedAt) },
    { label: 'URL', value: link(deviceRunSessionUrl) },
  ]);
}

function printArtifacts<TArtifact>(
  title: string,
  artifacts: TArtifact[],
  formatArtifactFields: (artifact: TArtifact) => FormatFieldsItem[]
): void {
  if (artifacts.length === 0) {
    return;
  }

  Log.addNewLineIfNone();
  Log.gray(`${title}:`);
  for (const artifact of artifacts) {
    Log.log(formatFields(formatArtifactFields(artifact)));
    Log.addNewLineIfNone();
  }
}

function formatDeviceRunSessionArtifactFields(
  artifact: DeviceRunSessionArtifact
): FormatFieldsItem[] {
  return [
    { label: '  ID', value: artifact.id },
    { label: '  Name', value: artifact.name },
    { label: '  Filename', value: artifact.filename },
    { label: '  File size', value: formatFileSize(artifact.fileSizeBytes) },
    { label: '  Created at', value: String(artifact.createdAt) },
    { label: '  Updated at', value: String(artifact.updatedAt) },
    { label: '  Metadata', value: formatMetadata(artifact.metadata) },
    { label: '  Download URL', value: link(artifact.downloadUrl) },
  ];
}

function formatFileSize(fileSizeBytes: number | null | undefined): string {
  return typeof fileSizeBytes === 'number'
    ? `${formatBytes(fileSizeBytes)} (${fileSizeBytes} B)`
    : 'null';
}

function formatMetadata(metadata: unknown): string {
  return metadata ? JSON.stringify(metadata) : 'null';
}

function formatNullable(value: unknown): string {
  return value ? String(value) : 'null';
}
