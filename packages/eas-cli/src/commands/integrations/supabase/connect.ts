import { Flags } from '@oclif/core';
import chalk from 'chalk';
import { z } from 'zod';

import EasCommand from '../../../commandUtils/EasCommand';
import { ExpoGraphqlClient } from '../../../commandUtils/context/contextUtils/createGraphqlClient';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../../commandUtils/flags';
import {
  formatSupabaseOrganization,
  formatSupabaseProjectLabel,
  getSupabaseProjectDashboardUrl,
  parseSupabaseProjectRef,
} from '../../../commandUtils/supabase';
import { SupabaseMutation } from '../../../graphql/mutations/SupabaseMutation';
import { SupabaseQuery } from '../../../graphql/queries/SupabaseQuery';
import {
  SupabaseConnectionData,
  SupabaseOrganizationData,
  SupabaseProjectData,
} from '../../../graphql/types/SupabaseConnection';
import Log, { link } from '../../../log';
import { getOwnerAccountForProjectIdAsync } from '../../../project/projectUtils';
import { promptAsync, selectAsync } from '../../../prompts';
import { enableJsonOutput, printJsonOnlyOutput } from '../../../utils/json';

import {
  EAS_SUPABASE_ENVIRONMENTS,
  parseEnvironmentFlag,
  resolveTargetEnvironmentsAsync,
} from '../../../integrations/supabase/environments';
import {
  EAS_SUPABASE_PUBLISHABLE_KEY_ENV_VAR_NAME,
  EAS_SUPABASE_URL_ENV_VAR_NAME,
  createSupabaseEnvVars,
  ensureAdditionalEnvWritesAllowedAsync,
  upsertEasEnvVarAsync,
  upsertEasEnvVarForEnvironmentsAsync,
  writeEnvLocalAsync,
  writeEnvVarsAsync,
} from '../../../integrations/supabase/env';
import {
  additionalProvisionFailureHint,
  authorizeViaBrowserAsync,
  loadOrganizationsBestEffortAsync,
  pollProvisionReceiptAsync,
  primaryProvisionFailureHint,
  projectNameSuffixForEnvironments,
  resolveOrganizationAsync,
  resolvePublishableKeyAsync,
  resolveRegionAsync,
} from '../../../integrations/supabase/provision';
import { setupSdkAndConfigAsync } from '../../../integrations/supabase/sdk';

const PrimaryProvisionResultSchema = z.object({
  supabaseProjectId: z.string().optional(),
  supabaseProjectRef: z.string().optional(),
});

const AdditionalProvisionResultSchema = z.object({
  supabaseProjectRef: z.string(),
  supabaseProjectName: z.string().optional(),
  supabaseProjectUrl: z.string(),
  supabaseRegion: z.string().optional(),
  publishableKey: z.string(),
});

type AdditionalProvisionResult = {
  supabaseProjectRef: string;
  supabaseProjectName: string;
  supabaseProjectUrl: string;
  supabaseRegion: string;
  publishableKey: string;
};

export default class IntegrationsSupabaseConnect extends EasCommand {
  static override description =
    'authorize Supabase, link or provision a project, install the SDK, and write EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --link <project-url>',
    '<%= config.bin %> <%= command.id %> --environment preview',
    '<%= config.bin %> <%= command.id %> --environment preview --region americas --non-interactive --overwrite',
    '<%= config.bin %> <%= command.id %> --reauth',
  ];

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
  };

  static override flags = {
    ...EasNonInteractiveAndJsonFlags,
    region: Flags.string({
      description:
        'Region when provisioning (americas | emea | apac, or e.g. us-east-1). Required with --non-interactive if provisioning. Ignored with --link or if already linked',
    }),
    organization: Flags.string({
      description:
        'Supabase org slug for a new primary project. Ignored with --link; incompatible with --environment',
    }),
    link: Flags.string({
      description:
        'Existing project URL or Reference ID (Project Settings → General). Sets the app primary instead of provisioning. Incompatible with --environment',
    }),
    reauth: Flags.boolean({
      description:
        'Disconnect the existing Supabase OAuth connection, then re-authorize in the browser. Removes the EAS connection and primary project link (Supabase projects are kept). Then prompts to link an existing project (default) or provision a new one; pass --link to skip the prompt. Interactive only; incompatible with --environment',
      default: false,
    }),
    overwrite: Flags.boolean({
      description:
        'Replace existing EXPO_PUBLIC_SUPABASE_* in .env.local and EAS without prompting',
      default: false,
    }),
    environment: Flags.string({
      description:
        'EAS environments for a separate hosted project (e.g. preview). Requires prior primary connect; writes URL/key only there. Incompatible with --link and --reauth',
    }),
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(IntegrationsSupabaseConnect);
    const {
      region: regionFlag,
      organization: organizationFlag,
      link: linkRefFlag,
      reauth,
      overwrite,
      environment: environmentFlag,
    } = flags;
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    const requestedEnvironments = parseEnvironmentFlag(environmentFlag);
    const linkProjectRef = linkRefFlag ? parseSupabaseProjectRef(linkRefFlag) : undefined;
    if (jsonFlag) {
      enableJsonOutput();
    }

    const {
      privateProjectConfig: { projectId, projectDir, exp },
      loggedIn: { graphqlClient },
    } = await this.getContextAsync(IntegrationsSupabaseConnect, {
      nonInteractive,
      withServerSideEnvironment: null,
    });

    if (requestedEnvironments) {
      if (linkRefFlag) {
        throw new Error(
          'Cannot combine --environment with --link. --link sets the primary project; --environment provisions an additional one for the listed EAS environments.'
        );
      }
      if (reauth) {
        throw new Error(
          'Cannot combine --environment with --reauth. Re-authorize first, then re-run with --environment.'
        );
      }
      if (organizationFlag) {
        throw new Error(
          'Cannot use --organization with --environment. The additional project uses the organization from the existing connection.'
        );
      }
      const targetEnvironments = await resolveTargetEnvironmentsAsync(
        graphqlClient,
        projectId,
        requestedEnvironments,
        nonInteractive
      );
      await this.runAdditionalEnvironmentSetupAsync({
        graphqlClient,
        projectId,
        targetEnvironments,
        regionFlag,
        nonInteractive,
        overwrite,
        jsonFlag,
      });
      return;
    }

    const account = await getOwnerAccountForProjectIdAsync(graphqlClient, projectId);

    let connection = await SupabaseQuery.getSupabaseConnectionByAccountIdAsync(
      graphqlClient,
      account.id
    );
    let didReauth = false;
    if (reauth) {
      if (!connection) {
        if (!nonInteractive) {
          Log.warn('--reauth ignored: no existing Supabase connection to reset.');
        }
      } else if (nonInteractive) {
        throw new Error(
          "--reauth re-authorizes in the browser, which isn't possible in non-interactive mode. Re-run `eas integrations:supabase:connect --reauth` interactively."
        );
      } else {
        Log.warn(
          'Resetting the Supabase connection. This removes the EAS connection and its project link (your Supabase projects are preserved). After authorizing, you will be asked to link an existing project (recommended) or provision a new one.'
        );
        await SupabaseMutation.disconnectSupabaseAsync(graphqlClient, connection.id);
        Log.withTick('Reset the existing Supabase connection');
        connection = null;
        didReauth = true;
      }
    }

    let organizations: SupabaseOrganizationData[] | null = null;
    if (connection) {
      organizations = await loadOrganizationsBestEffortAsync(graphqlClient, account.id);
      Log.withTick(
        `Using existing Supabase organization ${chalk.bold(
          formatSupabaseOrganization(connection, organizations ?? undefined)
        )}`
      );
    } else {
      connection = await authorizeViaBrowserAsync(graphqlClient, account, nonInteractive);
    }

    let project = await SupabaseQuery.getSupabaseProjectByAppIdAsync(graphqlClient, projectId);
    if (project) {
      Log.withTick(
        `Using existing Supabase project ${chalk.bold(formatSupabaseProjectLabel(project))}`
      );
      if (linkProjectRef && linkProjectRef !== project.supabaseProjectRef) {
        Log.warn(
          `Ignoring --link ${chalk.bold(linkProjectRef)}: this app is already linked to ${chalk.bold(
            project.supabaseProjectRef
          )}. Run \`eas integrations:supabase:disconnect\` first to link a different project.`
        );
      } else if (regionFlag || organizationFlag) {
        Log.warn(
          'Ignoring --region/--organization: this app is already linked to a Supabase project.'
        );
      }
    } else if (linkProjectRef) {
      // No org picker here: the project ref determines its organization, and the server validates
      // that it matches the connection's organization.
      project = await SupabaseMutation.linkSupabaseProjectAsync(graphqlClient, {
        appId: projectId,
        supabaseProjectRef: linkProjectRef,
      });
      Log.withTick(`Linked Supabase project ${chalk.bold(formatSupabaseProjectLabel(project))}`);
    } else if (didReauth) {
      const afterReauth = await this.resolveProjectAfterReauthAsync({
        graphqlClient,
        projectId,
        accountId: account.id,
        connection,
        organizationFlag,
        regionFlag,
        nonInteractive,
        organizations,
      });
      project = afterReauth.project;
      connection = afterReauth.connection;
    } else {
      connection = await resolveOrganizationAsync(
        graphqlClient,
        account.id,
        connection,
        organizationFlag,
        nonInteractive,
        organizations
      );
      const region = await resolveRegionAsync(regionFlag, nonInteractive);
      project = await this.provisionAndPollPrimaryProjectAsync(graphqlClient, projectId, region);
    }

    if (!connection) {
      throw new Error('Expected an authorized Supabase connection before continuing.');
    }

    const publishableKey = await resolvePublishableKeyAsync(graphqlClient, projectId, project);

    const envVars = createSupabaseEnvVars(project.supabaseProjectUrl, publishableKey);

    const manualSteps = await setupSdkAndConfigAsync(projectDir, exp, jsonFlag);

    const envLocalWritten = await writeEnvLocalAsync(
      projectDir,
      envVars,
      nonInteractive,
      overwrite
    );
    const easWritten = await writeEnvVarsAsync(envVars, envVar =>
      upsertEasEnvVarAsync(
        graphqlClient,
        projectId,
        envVar,
        EAS_SUPABASE_ENVIRONMENTS,
        nonInteractive,
        overwrite
      )
    );

    if (jsonFlag) {
      printJsonOnlyOutput({
        organizationConnection: {
          id: connection.id,
          organizationSlug: connection.supabaseOrganizationSlug,
        },
        project: {
          id: project.id,
          ref: project.supabaseProjectRef,
          url: project.supabaseProjectUrl,
          region: project.supabaseRegion,
        },
        dashboardUrl: getSupabaseProjectDashboardUrl(project),
        envLocalWritten,
        environmentVariables: envVars.map((v, i) => ({ name: v.name, easWritten: easWritten[i] })),
        manualSteps,
      });
      return;
    }

    this.printNextSteps(project, manualSteps);
  }

  private async resolveProjectAfterReauthAsync({
    graphqlClient,
    projectId,
    accountId,
    connection,
    organizationFlag,
    regionFlag,
    nonInteractive,
    organizations,
  }: {
    graphqlClient: ExpoGraphqlClient;
    projectId: string;
    accountId: string;
    connection: SupabaseConnectionData;
    organizationFlag: string | undefined;
    regionFlag: string | undefined;
    nonInteractive: boolean;
    organizations: SupabaseOrganizationData[] | null;
  }): Promise<{ project: SupabaseProjectData; connection: SupabaseConnectionData }> {
    // --reauth already required interactive mode when a connection existed.
    const choice = await selectAsync<'link' | 'provision'>(
      'The previous EAS project link was removed. What next?',
      [
        { title: 'Link an existing Supabase project (recommended)', value: 'link' },
        { title: 'Provision a new Supabase project', value: 'provision' },
      ],
      { initial: 'link' }
    );

    if (choice === 'link') {
      const { linkValue } = await promptAsync({
        type: 'text',
        name: 'linkValue',
        message: 'Supabase project ref or URL',
        validate: (value: string) => {
          try {
            parseSupabaseProjectRef(value);
            return true;
          } catch (error) {
            return error instanceof Error ? error.message : 'Invalid project ref or URL';
          }
        },
      });
      const project = await SupabaseMutation.linkSupabaseProjectAsync(graphqlClient, {
        appId: projectId,
        supabaseProjectRef: parseSupabaseProjectRef(linkValue),
      });
      Log.withTick(`Linked Supabase project ${chalk.bold(formatSupabaseProjectLabel(project))}`);
      return { project, connection };
    }

    const nextConnection = await resolveOrganizationAsync(
      graphqlClient,
      accountId,
      connection,
      organizationFlag,
      nonInteractive,
      organizations
    );
    const region = await resolveRegionAsync(regionFlag, nonInteractive);
    const project = await this.provisionAndPollPrimaryProjectAsync(
      graphqlClient,
      projectId,
      region
    );
    return { project, connection: nextConnection };
  }

  private async provisionAndPollPrimaryProjectAsync(
    graphqlClient: ExpoGraphqlClient,
    projectId: string,
    region: string
  ): Promise<SupabaseProjectData> {
    const receipt = await SupabaseMutation.provisionSupabaseProjectAsync(graphqlClient, {
      appId: projectId,
      region,
    });
    const { finalized, spinner } = await pollProvisionReceiptAsync(graphqlClient, receipt, {
      startMessage: 'Provisioning Supabase project (this can take a minute)…',
      waitingMessage: 'Waiting for Expo to finish Supabase setup…',
      failureMessage: 'Failed to provision the Supabase project',
      failureHint: primaryProvisionFailureHint(),
    });
    const parsedResult = PrimaryProvisionResultSchema.safeParse(finalized.resultData);
    const resultData = parsedResult.success ? parsedResult.data : undefined;
    const project = await SupabaseQuery.getSupabaseProjectByAppIdAsync(graphqlClient, projectId, {
      useCache: false,
    });
    if (!project) {
      throw new Error(
        resultData?.supabaseProjectRef
          ? `Provision succeeded for project ${resultData.supabaseProjectRef}, but the Expo project link was not found. Try again, or link with --link ${resultData.supabaseProjectRef}.`
          : 'Provision succeeded but the Expo project link was not found. Try again, or link an existing project with --link.'
      );
    }
    spinner.succeed(
      `Provisioned Supabase project ${chalk.bold(formatSupabaseProjectLabel(project))}`
    );
    return project;
  }

  private async runAdditionalEnvironmentSetupAsync({
    graphqlClient,
    projectId,
    targetEnvironments,
    regionFlag,
    nonInteractive,
    overwrite,
    jsonFlag,
  }: {
    graphqlClient: ExpoGraphqlClient;
    projectId: string;
    targetEnvironments: string[];
    regionFlag: string | undefined;
    nonInteractive: boolean;
    overwrite: boolean;
    jsonFlag: boolean;
  }): Promise<void> {
    const account = await getOwnerAccountForProjectIdAsync(graphqlClient, projectId);
    let connection = await SupabaseQuery.getSupabaseConnectionByAccountIdAsync(
      graphqlClient,
      account.id
    );
    if (!connection) {
      throw new Error(
        'No Supabase connection found. Run `eas integrations:supabase:connect` first, then re-run with --environment.'
      );
    }

    const primaryProject = await SupabaseQuery.getSupabaseProjectByAppIdAsync(
      graphqlClient,
      projectId
    );
    if (!primaryProject) {
      throw new Error(
        'No primary Supabase project is linked yet. Run `eas integrations:supabase:connect` without --environment first.'
      );
    }

    const organizations = await loadOrganizationsBestEffortAsync(graphqlClient, account.id);
    Log.withTick(
      `Using existing Supabase organization ${chalk.bold(
        formatSupabaseOrganization(connection, organizations ?? undefined)
      )}`
    );
    Log.withTick(
      `Primary project remains ${chalk.bold(formatSupabaseProjectLabel(primaryProject))}; provisioning an additional project for ${targetEnvironments.join(', ')}`
    );

    const region = await resolveRegionAsync(regionFlag, nonInteractive);
    const projectNameSuffix = projectNameSuffixForEnvironments(targetEnvironments);

    // Fail closed before billing: refuse to provision if we already know env writes will be skipped.
    const confirmedOverwrite = await ensureAdditionalEnvWritesAllowedAsync(
      graphqlClient,
      projectId,
      targetEnvironments,
      nonInteractive,
      overwrite
    );
    const effectiveOverwrite = overwrite || confirmedOverwrite;

    const additional = await this.provisionAndPollAdditionalProjectAsync(graphqlClient, projectId, {
      region,
      projectNameSuffix,
      targetEnvironments,
    });

    const envVars = createSupabaseEnvVars(additional.supabaseProjectUrl, additional.publishableKey);

    const dashboardUrl = getSupabaseProjectDashboardUrl({
      supabaseProjectRef: additional.supabaseProjectRef,
    });

    let easWritten: boolean[] = [];
    try {
      easWritten = await writeEnvVarsAsync(envVars, envVar =>
        upsertEasEnvVarForEnvironmentsAsync(
          graphqlClient,
          projectId,
          envVar,
          targetEnvironments,
          nonInteractive,
          effectiveOverwrite
        )
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw this.additionalEnvWriteFailureError({
        additional,
        targetEnvironments,
        dashboardUrl,
        headline: `Provisioned additional Supabase project ${additional.supabaseProjectRef}, but could not write EAS environment variables for ${targetEnvironments.join(', ')}: ${message}`,
      });
    }
    if (easWritten.some(written => !written)) {
      throw this.additionalEnvWriteFailureError({
        additional,
        targetEnvironments,
        dashboardUrl,
        headline: `Provisioned additional Supabase project ${additional.supabaseProjectRef}, but did not write all EAS environment variables for ${targetEnvironments.join(', ')}.`,
      });
    }

    if (jsonFlag) {
      printJsonOnlyOutput({
        additionalProject: {
          ref: additional.supabaseProjectRef,
          url: additional.supabaseProjectUrl,
          region: additional.supabaseRegion,
        },
        environments: targetEnvironments,
        dashboardUrl,
        environmentVariables: envVars.map((v, i) => ({ name: v.name, easWritten: easWritten[i] })),
      });
      return;
    }

    Log.addNewLineIfNone();
    Log.log(chalk.green('Additional Supabase project is ready!'));
    Log.newLine();
    Log.log(`${chalk.bold('Dashboard')}: ${link(dashboardUrl, { dim: false })}`);
    Log.log(
      `EAS environment variables updated for: ${targetEnvironments.map(env => chalk.bold(env)).join(', ')}`
    );
    Log.log(
      `Primary linked project is unchanged (${chalk.bold(primaryProject.supabaseProjectRef)}).`
    );
  }

  private async provisionAndPollAdditionalProjectAsync(
    graphqlClient: ExpoGraphqlClient,
    projectId: string,
    {
      region,
      projectNameSuffix,
      targetEnvironments,
    }: { region: string; projectNameSuffix: string; targetEnvironments: string[] }
  ): Promise<AdditionalProvisionResult> {
    const receipt = await SupabaseMutation.provisionAdditionalSupabaseProjectAsync(graphqlClient, {
      appId: projectId,
      region,
      projectNameSuffix,
    });
    const { finalized, spinner } = await pollProvisionReceiptAsync(graphqlClient, receipt, {
      startMessage: `Provisioning additional Supabase project for ${targetEnvironments.join(', ')}…`,
      waitingMessage: 'Waiting for Expo to finish additional Supabase setup…',
      failureMessage: 'Failed to provision the additional Supabase project',
      failureHint: additionalProvisionFailureHint(targetEnvironments),
    });
    const parsedResult = AdditionalProvisionResultSchema.safeParse(finalized.resultData);
    if (!parsedResult.success) {
      throw new Error(
        'Additional provision succeeded but did not return project credentials. Open your Supabase dashboard, copy the project URL and publishable key, and set EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY on the target EAS environments. Do not re-run connect --environment — that would create another project.'
      );
    }
    const resultData = parsedResult.data;
    const additional: AdditionalProvisionResult = {
      supabaseProjectRef: resultData.supabaseProjectRef,
      supabaseProjectName: resultData.supabaseProjectName ?? resultData.supabaseProjectRef,
      supabaseProjectUrl: resultData.supabaseProjectUrl,
      supabaseRegion: resultData.supabaseRegion ?? region,
      publishableKey: resultData.publishableKey,
    };
    spinner.succeed(
      `Provisioned additional Supabase project ${chalk.bold(formatSupabaseProjectLabel(additional))}`
    );
    return additional;
  }

  private additionalEnvWriteFailureError({
    additional,
    targetEnvironments,
    dashboardUrl,
    headline,
  }: {
    additional: Pick<AdditionalProvisionResult, 'supabaseProjectUrl' | 'publishableKey'>;
    targetEnvironments: string[];
    dashboardUrl: string;
    headline: string;
  }): Error {
    return new Error(
      [
        headline,
        `Do not re-run connect --environment — the Supabase project already exists. Set these on ${targetEnvironments.join(', ')}:`,
        `  EXPO_PUBLIC_SUPABASE_URL=${additional.supabaseProjectUrl}`,
        `  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${additional.publishableKey}`,
        `Dashboard: ${dashboardUrl}`,
      ].join('\n')
    );
  }

  private printNextSteps(project: SupabaseProjectData, manualSteps: string[]): void {
    Log.addNewLineIfNone();
    Log.log(chalk.green('Supabase is connected!'));
    Log.newLine();
    Log.log(
      `${chalk.bold('Dashboard')}: ${link(getSupabaseProjectDashboardUrl(project), { dim: false })}`
    );
    Log.newLine();
    Log.log('Next steps:');
    Log.log(
      `  1. Create a Supabase client (e.g. ${chalk.bold('lib/supabase.ts')}) following our guide (${chalk.cyan('https://docs.expo.dev/guides/using-supabase')}). It reads ${chalk.bold(EAS_SUPABASE_URL_ENV_VAR_NAME)} and ${chalk.bold(EAS_SUPABASE_PUBLISHABLE_KEY_ENV_VAR_NAME)} — no extra config plugin or dev build needed.`
    );
    Log.log(
      `  2. For local development, run ${chalk.cyan('supabase start')} and point ${chalk.bold(EAS_SUPABASE_URL_ENV_VAR_NAME)} at the local stack (see the guide).`
    );
    Log.log(
      `  3. For a separate hosted project for Preview (or other EAS environments), re-run ${chalk.cyan('eas integrations:supabase:connect --environment preview')}.`
    );

    if (manualSteps.length > 0) {
      Log.newLine();
      Log.warn('Finish setup manually:');
      for (const step of manualSteps) {
        if (step.includes('\n')) {
          for (const line of step.split('\n')) {
            Log.warn(`  ${line}`);
          }
        } else {
          Log.warn(`  • ${step}`);
        }
      }
    }
  }
}
