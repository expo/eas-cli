import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../../commandUtils/flags';
import {
  formatSupabaseProject,
  formatSupabaseProjectLabel,
  logNoSupabaseProject,
} from '../../../commandUtils/supabase';
import { SupabaseMutation } from '../../../graphql/mutations/SupabaseMutation';
import { SupabaseQuery } from '../../../graphql/queries/SupabaseQuery';
import Log from '../../../log';
import { ora } from '../../../ora';
import { confirmAsync } from '../../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';

export default class IntegrationsSupabaseDisconnect extends EasCommand {
  static override description =
    "remove this app's Supabase project link from EAS (keeps the Supabase project; does not delete EXPO_PUBLIC_SUPABASE_* env vars)";

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --yes',
  ];

  static override flags = {
    ...EasNonInteractiveAndJsonFlags,
    yes: Flags.boolean({
      char: 'y',
      description: 'Skip confirmation prompt',
      default: false,
    }),
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(IntegrationsSupabaseDisconnect);
    const { yes } = flags;
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    if (jsonFlag) {
      enableJsonOutput();
    }

    const {
      privateProjectConfig: { projectId, exp },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(IntegrationsSupabaseDisconnect, {
      nonInteractive,
      withServerSideEnvironment: null,
    });

    const project = await SupabaseQuery.getSupabaseProjectByAppIdAsync(graphqlClient, projectId);
    if (!project) {
      if (jsonFlag) {
        printJsonOnlyOutput({ id: null });
      } else {
        logNoSupabaseProject(exp.slug);
      }
      return;
    }

    if (!jsonFlag) {
      Log.addNewLineIfNone();
      Log.log(formatSupabaseProject(project));
      Log.newLine();
    }

    if (!nonInteractive && !yes) {
      const confirmed = await confirmAsync({
        message:
          'Remove this Supabase project link from EAS servers? This does not delete the project on Supabase.',
      });
      if (!confirmed) {
        Log.warn('Canceled removal of the Supabase project link.');
        return;
      }
    } else if (!jsonFlag) {
      Log.warn(
        'Removing the Supabase project link from EAS servers. This does not delete the project on Supabase.'
      );
    }

    const spinner = jsonFlag ? null : ora('Removing Supabase project link').start();
    try {
      await SupabaseMutation.deleteSupabaseProjectAsync(graphqlClient, project.id);
      spinner?.succeed(
        `Removed Supabase project ${chalk.bold(formatSupabaseProjectLabel(project))} from EAS servers`
      );
    } catch (error) {
      spinner?.fail('Failed to remove Supabase project link');
      throw error;
    }

    if (jsonFlag) {
      printJsonOnlyOutput({ id: project.id, ref: project.supabaseProjectRef });
      return;
    }

    Log.newLine();
    Log.log(
      `The ${chalk.bold('EXPO_PUBLIC_SUPABASE_URL')} and ${chalk.bold(
        'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY'
      )} values remain in ${chalk.bold('.env.local')} and in your EAS environment variables. Remove them if you no longer need them.`
    );
  }
}
