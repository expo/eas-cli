import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
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
import {
  SupabaseAdvisorLintsData,
  SupabaseAdvisorType,
} from '../../../graphql/types/SupabaseConnection';
import Log from '../../../log';
import { ora } from '../../../ora';
import { confirmAsync } from '../../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';

const ADVISOR_TYPES = [SupabaseAdvisorType.Security, SupabaseAdvisorType.Performance];
const REAUTH_COMMAND = 'eas integrations:supabase:connect --reauth';

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

    const project = await SupabaseQuery.getSupabaseProjectByAppIdAsync(graphqlClient, projectId);
    if (!project) {
      if (jsonFlag) {
        printJsonOnlyOutput({ project: null, security: null, performance: null });
      } else {
        logNoSupabaseProject(exp.slug);
      }
      return;
    }

    let result = await this.fetchLintsAsync(graphqlClient, projectId);
    if (!result) {
      if (nonInteractive) {
        throw new EasCommandError(
          `Expo cannot read this project's advisors until the Supabase connection grants the database read permission. Run ${chalk.bold(REAUTH_COMMAND)} and try again.`
        );
      }
      Log.warn(
        'Expo cannot read the Supabase advisors until the Supabase connection is re-authorized with the database read permission.'
      );
      const confirmed = await confirmAsync({
        message: 'Re-authorize Supabase in your browser now?',
      });
      if (!confirmed) {
        throw new EasCommandError(
          `Run ${chalk.bold(REAUTH_COMMAND)} when you are ready to re-authorize.`
        );
      }
      await this.config.runCommand('integrations:supabase:connect', [
        '--reauth',
        '--link',
        project.supabaseProjectRef,
      ]);
      Log.newLine();
      result = await this.fetchLintsAsync(graphqlClient, projectId);
      if (!result) {
        throw new EasCommandError(
          `Supabase still denies access to the advisors after re-authorizing. Check that the Expo integration is allowed to read the database for ${chalk.bold(formatSupabaseProjectLabel(project))}.`
        );
      }
    }

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

  private async fetchLintsAsync(
    graphqlClient: ExpoGraphqlClient,
    projectId: string
  ): Promise<SupabaseAdvisorLintsData | null> {
    const spinner = ora('Fetching Supabase advisor findings').start();
    try {
      const result = await SupabaseQuery.getSupabaseAdvisorLintsByAppIdAsync(
        graphqlClient,
        projectId
      );
      if (result) {
        spinner.succeed(
          `Fetched Supabase advisor findings for ${formatSupabaseProjectLabel(result.project)}`
        );
      } else {
        spinner.stop();
      }
      return result;
    } catch (error) {
      if (isSupabaseReauthorizationRequiredError(error)) {
        spinner.fail('Supabase needs to be re-authorized');
        return null;
      }
      spinner.fail('Failed to fetch Supabase advisor findings');
      throw error;
    }
  }
}
