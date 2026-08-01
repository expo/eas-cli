import { Flags } from '@oclif/core';
import chalk from 'chalk';

import EasCommand from '../../commandUtils/EasCommand';
import {
  EasNonInteractiveAndJsonFlags,
  resolveNonInteractiveAndJsonFlags,
} from '../../commandUtils/flags';
import { AppPlatform, SubmissionWithSubmittedBuildFragment } from '../../graphql/generated';
import Log from '../../log';
import { ora } from '../../ora';
import { RequestedPlatform } from '../../platform';
import { getRecentSubmissionsAsync } from '../../submit/queries';
import { IosStoreStatus, getIosStoreStatusAsync, renderIosStoreStatus } from '../../submit/status';
import { resolveTestFlightAppAsync } from '../../testflight/app';
import { enableJsonOutput, printJsonOnlyOutput } from '../../utils/json';

const ANDROID_STATUS_UNAVAILABLE_MESSAGE =
  'Google Play app status is not available through EAS yet. Run `eas submit:list -p android` to see recent Android submissions.';

export default class SubmissionStatus extends EasCommand {
  static override description =
    'show the status of your app on the App Store: the live version and TestFlight builds\n\n' +
    'This command reads from App Store Connect and requires an ASC API key. Provide one via:\n' +
    '  - Environment variables: EXPO_ASC_API_KEY_PATH, EXPO_ASC_KEY_ID, EXPO_ASC_ISSUER_ID\n' +
    '  - eas.json submit profile: ascApiKeyPath, ascApiKeyId, ascApiKeyIssuerId\n' +
    '  - EAS credentials service: run `eas credentials` to set up an API key\n' +
    'Without a key, the command offers an interactive Apple login; in non-interactive mode it fails.\n\n' +
    'Google Play app status is not available through EAS yet. Run `eas submit:list -p android` to see recent Android submissions.';

  static override examples = [
    '$ eas submit:status  \t # live App Store version and TestFlight builds',
    '$ eas submit:status --json --non-interactive  \t # machine-readable output',
  ];

  static override flags = {
    platform: Flags.option({
      char: 'p',
      options: Object.values(RequestedPlatform),
    })(),
    profile: Flags.string({
      char: 'e',
      description:
        'Name of the submit profile from eas.json used to resolve the App Store Connect API key. Defaults to "production".',
    }),
    ...EasNonInteractiveAndJsonFlags,
  };

  static override contextDefinition = {
    ...this.ContextOptions.ProjectConfig,
    ...this.ContextOptions.LoggedIn,
    ...this.ContextOptions.Analytics,
    ...this.ContextOptions.Vcs,
  };

  async runAsync(): Promise<void> {
    const { flags } = await this.parse(SubmissionStatus);
    const { json: jsonFlag, nonInteractive } = resolveNonInteractiveAndJsonFlags(flags);
    const requestedPlatform = flags.platform ?? RequestedPlatform.All;
    // Redirect stdout before context setup — resolving the project config can log messages,
    // and with --json those must go to stderr.
    if (jsonFlag) {
      enableJsonOutput();
    }

    const {
      loggedIn: { actor, graphqlClient },
      privateProjectConfig: { exp, projectId, projectDir },
      analytics,
      vcsClient,
    } = await this.getContextAsync(SubmissionStatus, {
      nonInteractive,
      withServerSideEnvironment: null,
    });

    const includeIos = [RequestedPlatform.All, RequestedPlatform.Ios].includes(requestedPlatform);
    const includeAndroid = [RequestedPlatform.All, RequestedPlatform.Android].includes(
      requestedPlatform
    );

    let iosStatus: IosStoreStatus | null = null;
    let iosSubmissions: SubmissionWithSubmittedBuildFragment[] = [];
    if (includeIos) {
      const spinner = ora().start('Fetching submissions…');
      try {
        iosSubmissions = await getRecentSubmissionsAsync(graphqlClient, {
          projectId,
          filter: { platform: AppPlatform.Ios },
        });
        spinner.stop();
      } catch (error) {
        spinner.fail(
          "Something went wrong and we couldn't fetch the submissions for this project."
        );
        throw error;
      }

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
      const ascSpinner = ora().start('Fetching App Store status…');
      try {
        iosStatus = await getIosStoreStatusAsync(app, iosSubmissions);
        ascSpinner.stop();
      } catch (error) {
        ascSpinner.fail("Something went wrong and we couldn't fetch the App Store status.");
        throw error;
      }
    }

    if (jsonFlag) {
      printJsonOnlyOutput({
        ...(includeIos && { ios: iosStatus }),
        ...(includeAndroid && {
          android: { available: false, message: ANDROID_STATUS_UNAVAILABLE_MESSAGE },
        }),
      });
      return;
    }

    if (iosStatus) {
      renderIosStoreStatus(iosStatus, iosSubmissions);
    }
    if (includeAndroid) {
      Log.addNewLineIfNone();
      Log.log(chalk.bold('Android — Google Play'));
      Log.log(chalk.dim(`  ${ANDROID_STATUS_UNAVAILABLE_MESSAGE}`));
    }
  }
}
