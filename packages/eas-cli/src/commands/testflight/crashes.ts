import { Args, Flags } from '@oclif/core';

import EasCommand from '../../commandUtils/EasCommand';
import { EasNonInteractiveAndJsonFlags } from '../../commandUtils/flags';
import {
  EasPaginatedQueryFlags,
  getLimitFlagWithCustomValues,
  getPaginatedQueryOptions,
} from '../../commandUtils/pagination';
import { resolveTestFlightAppAsync } from '../../testflight/app';
import {
  TESTFLIGHT_PAGE_SIZE,
  listAndRenderTestFlightCrashesAsync,
  viewAndRenderBetaFeedbackAsync,
} from '../../testflight/queries';
import { resolveBetaFeedbackTarget } from '../../testflight/target';
import { enableJsonOutput } from '../../utils/json';

export default class TestFlightCrashes extends EasCommand {
  static override description =
    'display crashes reported by TestFlight testers, or the full crash log of a single crash';

  static override examples = [
    '$ eas testflight:crashes  \t # Show the most recent crashes',
    '$ eas testflight:crashes --limit 50 --offset 20  \t # Page through crashes',
    '$ eas testflight:crashes AAo2eIIfGzcb1BzuUv3xrh4  \t # Show the full crash log for one crash',
    '$ eas testflight:crashes --json  \t # Print a page of crashes, with paging metadata, as JSON',
    '$ eas testflight:crashes ${{ app_store_connect.beta_feedback.url }} --json  \t # Look up whatever an EAS workflow trigger reported',
  ];

  static override args = {
    id: Args.string({
      description:
        'ID or App Store Connect API URL of a single submission to show. Accepts ${{ app_store_connect.beta_feedback.id }} or ${{ app_store_connect.beta_feedback.url }} from an EAS workflow trigger.',
      required: false,
    }),
  };

  static override flags = {
    type: Flags.option({
      description:
        'Kind of feedback the ID refers to. Only needed when passing a bare ID for screenshot feedback; a URL already encodes it.',
      options: ['crash', 'screenshot'] as const,
    })(),
    profile: Flags.string({
      char: 'e',
      description:
        'Name of the submit profile from eas.json used to resolve the bundle identifier and App Store Connect API key. Defaults to "production".',
    }),
    ...EasPaginatedQueryFlags,
    limit: getLimitFlagWithCustomValues({ defaultTo: TESTFLIGHT_PAGE_SIZE, limit: 200 }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.Analytics,
    ...this.ContextOptions.Vcs,
  };

  async runAsync(): Promise<void> {
    const { args, flags } = await this.parse(TestFlightCrashes);
    const paginatedQueryOptions = getPaginatedQueryOptions(flags);
    const { json, nonInteractive } = paginatedQueryOptions;
    if (json) {
      enableJsonOutput();
    }

    if (flags.type && !args.id) {
      throw new Error('--type only applies when looking up a single submission by ID or URL.');
    }

    // Resolved before authenticating so a malformed ID or URL fails fast.
    const target = args.id
      ? resolveBetaFeedbackTarget({ idOrUrl: args.id, type: flags.type, defaultType: 'crash' })
      : null;

    const {
      loggedIn: { actor, graphqlClient },
      privateProjectConfig: { exp, projectId, projectDir },
      analytics,
      vcsClient,
    } = await this.getContextAsync(TestFlightCrashes, {
      nonInteractive,
      withServerSideEnvironment: null,
    });

    const app = await resolveTestFlightAppAsync({
      actor,
      analytics,
      exp,
      graphqlClient,
      nonInteractive,
      profileName: flags.profile,
      projectDir,
      projectId,
      vcsClient,
    });

    if (target) {
      await viewAndRenderBetaFeedbackAsync(app, target, { json });
      return;
    }

    await listAndRenderTestFlightCrashesAsync(app, paginatedQueryOptions);
  }
}
