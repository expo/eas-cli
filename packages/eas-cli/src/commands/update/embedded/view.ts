import { Args, Errors } from '@oclif/core';

import EasCommand from '../../../commandUtils/EasCommand';
import { EasJsonOnlyFlag } from '../../../commandUtils/flags';
import {
  EmbeddedUpdateFragment,
  EmbeddedUpdateQuery,
  isEmbeddedUpdateNotFoundError,
} from '../../../graphql/queries/EmbeddedUpdateQuery';
import Log from '../../../log';
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
            `Verify the id is correct and belongs to this app.`,
          { exit: 1 }
        );
      }
      throw e;
    }

    if (jsonFlag) {
      printJsonOnlyOutput(embeddedUpdate);
      return;
    }

    Log.log(formatEmbeddedUpdate(embeddedUpdate));
  }
}

export function formatEmbeddedUpdate(embeddedUpdate: EmbeddedUpdateFragment): string {
  return formatFields([
    { label: 'ID', value: embeddedUpdate.id },
    { label: 'Platform', value: embeddedUpdate.platform.toLowerCase() },
    { label: 'Runtime version', value: embeddedUpdate.runtimeVersion },
    { label: 'Channel', value: embeddedUpdate.channel },
    { label: 'Created at', value: new Date(embeddedUpdate.createdAt).toLocaleString() },
  ]);
}
