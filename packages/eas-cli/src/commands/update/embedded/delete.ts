import { Args } from '@oclif/core';

import EasCommand from '../../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../../commandUtils/flags';
import { EmbeddedUpdateMutation } from '../../../graphql/mutations/EmbeddedUpdateMutation';
import Log from '../../../log';
import { toggleConfirmAsync } from '../../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';

export default class UpdateEmbeddedDelete extends EasCommand {
  static override description = 'delete an embedded update registered with EAS Update';

  static override args = {
    id: Args.string({
      required: true,
      description: 'The ID of the embedded update (manifest UUID from app.manifest).',
    }),
  };

  static override flags = {
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const {
      args: { id: embeddedUpdateId },
      flags,
    } = await this.parse(UpdateEmbeddedDelete);
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);

    const {
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(UpdateEmbeddedDelete, { nonInteractive });

    if (jsonFlag) {
      enableJsonOutput();
    }

    if (!nonInteractive) {
      Log.log(
        `You are about to permanently delete embedded update: "${embeddedUpdateId}". ` +
          `Diff patches already generated against this bundle keep serving, but new diffs ` +
          `can't be generated until you re-upload it.`
      );
      Log.newLine();
      const confirmed = await toggleConfirmAsync({ message: 'Are you sure you wish to proceed?' });
      if (!confirmed) {
        Log.error(`Canceled deletion of embedded update: "${embeddedUpdateId}".`);
        process.exit(1);
      }
    }

    // Best-effort delete on the server: deleting an unknown id succeeds (idempotent),
    // so we don't need a not-found branch here.
    await EmbeddedUpdateMutation.deleteEmbeddedUpdateAsync(graphqlClient, {
      id: embeddedUpdateId,
    });

    if (jsonFlag) {
      printJsonOnlyOutput({ id: embeddedUpdateId });
      return;
    }
    Log.withTick(`Deleted embedded update ${embeddedUpdateId}`);
  }
}
