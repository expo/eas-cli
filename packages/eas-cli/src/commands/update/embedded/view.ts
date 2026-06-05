import { Args, Errors } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../../commandUtils/EasCommand';
import { EasJsonOnlyFlag } from '../../../commandUtils/flags';
import {
  EmbeddedUpdateFragment,
  EmbeddedUpdateQuery,
  isEmbeddedUpdateNotFoundError,
} from '../../../graphql/queries/EmbeddedUpdateQuery';
import Log from '../../../log';
import { fromNow } from '../../../utils/date';
import { formatBytes } from '../../../utils/files';
import formatFields from '../../../utils/formatFields';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';

export default class UpdateEmbeddedView extends EasCommand {
  static override description = 'view details of an embedded update registered with EAS Update';

  static override args = {
    id: Args.string({
      required: true,
      description: 'The ID of the embedded update (manifest UUID from app.manifest).',
    }),
  };

  static override flags = {
    ...EasJsonOnlyFlag,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const {
      args: { id: embeddedUpdateId },
      flags: { json: jsonFlag },
    } = await this.parse(UpdateEmbeddedView);

    const {
      projectId,
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(UpdateEmbeddedView, { nonInteractive: true });

    if (jsonFlag) {
      enableJsonOutput();
    }

    let embeddedUpdate;
    try {
      embeddedUpdate = await EmbeddedUpdateQuery.viewByIdAsync(graphqlClient, {
        embeddedUpdateId,
        appId: projectId,
      });
    } catch (e: unknown) {
      if (isEmbeddedUpdateNotFoundError(e)) {
        Errors.error(
          `No embedded update found with id "${embeddedUpdateId}" for this project. ` +
            `Run "eas update:embedded:list" to see the embedded updates registered for this app.`,
          { exit: 1 }
        );
      }
      throw e;
    }

    if (jsonFlag) {
      printJsonOnlyOutput(embeddedUpdate);
      return;
    }

    Log.addNewLineIfNone();
    Log.log(chalk.bold('Embedded update:'));
    Log.log(formatEmbeddedUpdate(embeddedUpdate));
  }
}

export function formatEmbeddedUpdate(embeddedUpdate: EmbeddedUpdateFragment): string {
  const createdAt = new Date(embeddedUpdate.createdAt);
  const bundleSize =
    embeddedUpdate.launchAsset.finalFileSize ?? embeddedUpdate.launchAsset.fileSize;
  return formatFields([
    { label: 'ID', value: embeddedUpdate.id },
    { label: 'Platform', value: embeddedUpdate.platform.toLowerCase() },
    { label: 'Runtime version', value: embeddedUpdate.runtimeVersion },
    { label: 'Channel', value: embeddedUpdate.channel },
    { label: 'Bundle size', value: formatBytes(bundleSize) },
    { label: 'Bundle SHA-256', value: embeddedUpdate.launchAsset.fileSHA256 },
    {
      label: 'Created at',
      value: `${createdAt.toLocaleString()} (${fromNow(createdAt)} ago)`,
    },
  ]);
}
