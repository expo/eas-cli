import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../../commandUtils/EasCommand';
import { EasCommandError } from '../../../commandUtils/errors';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../../commandUtils/flags';
import {
  formatSupabaseAdvisorLints,
  formatSupabaseProjectLabel,
  getSupabaseAdvisorsDashboardUrl,
  isSupabaseReauthorizationRequiredError,
  logNoSupabaseProject,
} from '../../../commandUtils/supabase';
import { SupabaseQuery } from '../../../graphql/queries/SupabaseQuery';
import { SupabaseAdvisorType } from '../../../graphql/types/SupabaseConnection';
import Log from '../../../log';
import { ora } from '../../../ora';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';

const ADVISOR_TYPES = [SupabaseAdvisorType.Security, SupabaseAdvisorType.Performance];

export default class IntegrationsSupabaseAdvisors extends EasCommand {
  static override description =
    "list unresolved findings from the Supabase Security and Performance Advisors for this app's primary Supabase project";

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --type security',
    '<%= config.bin %> <%= command.id %> --json --non-interactive',
  ];

  static override flags = {
    type: Flags.string({
      description: 'Only show one advisor',
      options: ['security', 'performance'],
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(IntegrationsSupabaseAdvisors);
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    if (jsonFlag) {
      enableJsonOutput();
    }
    const types =
      flags.type === 'security'
        ? [SupabaseAdvisorType.Security]
        : flags.type === 'performance'
          ? [SupabaseAdvisorType.Performance]
          : ADVISOR_TYPES;

    const {
      privateProjectConfig: { projectId, exp },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(IntegrationsSupabaseAdvisors, {
      nonInteractive,
      withServerSideEnvironment: null,
    });

    const spinner = ora('Fetching Supabase advisor findings').start();
    let result;
    try {
      result = await SupabaseQuery.getSupabaseAdvisorLintsByAppIdAsync(graphqlClient, projectId);
    } catch (error) {
      if (isSupabaseReauthorizationRequiredError(error)) {
        spinner.fail('Supabase needs to be re-authorized');
        throw new EasCommandError(
          `Expo cannot read this project's advisors until the Supabase connection grants the database read permission. Run ${chalk.bold('eas integrations:supabase:connect --reauth')} and try again.`
        );
      }
      spinner.fail('Failed to fetch Supabase advisor findings');
      throw error;
    }

    if (!result) {
      spinner.stop();
      if (jsonFlag) {
        printJsonOnlyOutput({ project: null, security: null, performance: null });
      } else {
        logNoSupabaseProject(exp.slug);
      }
      return;
    }
    spinner.succeed(
      `Fetched Supabase advisor findings for ${formatSupabaseProjectLabel(result.project)}`
    );

    if (jsonFlag) {
      printJsonOnlyOutput({
        project: {
          ref: result.project.supabaseProjectRef,
          name: result.project.supabaseProjectName,
          dashboardUrls: Object.fromEntries(
            types.map(type => [
              type.toLowerCase(),
              getSupabaseAdvisorsDashboardUrl(result.project, type),
            ])
          ),
        },
        security: types.includes(SupabaseAdvisorType.Security) ? result.security : undefined,
        performance: types.includes(SupabaseAdvisorType.Performance)
          ? result.performance
          : undefined,
      });
      return;
    }

    for (const type of types) {
      const lints = type === SupabaseAdvisorType.Security ? result.security : result.performance;
      Log.newLine();
      Log.log(formatSupabaseAdvisorLints(result.project, type, lints ?? []));
    }
  }
}
