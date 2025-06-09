import fs from 'fs';

import { WorkflowRunResult } from './runs';
import EasCommand from '../../commandUtils/EasCommand';
import { WorkflowRunMutation } from '../../graphql/mutations/WorkflowRunMutation';
import Log from '../../log';

export default class WorkflowRunCancel extends EasCommand {
  static override description =
    'Cancel one or more workflow runs. Pass in the --fromJson flag to cancel all runs from a JSON file created with `eas workflow:runs --json`.';

  static override strict = false;

  static override contextDefinition = {
    ...this.ContextOptions.ProjectId,
    ...this.ContextOptions.LoggedIn,
  };

  async runAsync(): Promise<void> {
    const { argv } = await this.parse(WorkflowRunCancel);
    const {
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(WorkflowRunCancel, {
      nonInteractive: true,
    });

    // Custom parsing of argv
    const tokens = [...argv];
    const workflowRunIds: Set<string> = new Set();
    if (tokens.length === 0) {
      throw new Error('Must provide at least one workflow run ID, or the --all flag');
    }

    let jsonFile: string | null = null;
    while (tokens.length > 0) {
      const token = tokens.shift();
      if (token === '--fromJson') {
        if (!tokens.length) {
          throw new Error('Must provide a JSON file path when using the --fromJson flag');
        }
        jsonFile = tokens.shift() as unknown as string;
      } else {
        workflowRunIds.add(token as unknown as string);
      }
    }
    if (jsonFile && workflowRunIds.size > 0) {
      throw new Error('Cannot provide workflow run IDs when using the --fromJson flag');
    }

    if (jsonFile) {
      const json = await fs.promises.readFile(jsonFile, 'utf8');
      const runs: WorkflowRunResult[] = JSON.parse(json);
      for (const run of runs) {
        if (run.status !== 'IN_PROGRESS') {
          Log.warn(`Skipping workflow run ${run.id} because it is not in progress`);
          continue;
        }
        workflowRunIds.add(run.id);
      }
    }

    Log.addNewLineIfNone();
    for (const workflowRunId of workflowRunIds) {
      try {
        await WorkflowRunMutation.cancelWorkflowRunAsync(graphqlClient, {
          workflowRunId,
        });

        Log.log(`Workflow run ${workflowRunId} has been canceled.`);
      } catch (e: any) {
        Log.error(`Failed to cancel workflow run ${workflowRunId}: ${e}`);
      }
    }
    Log.addNewLineIfNone();
  }
}
