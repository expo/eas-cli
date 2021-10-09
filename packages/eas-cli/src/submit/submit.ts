import { Platform } from '@expo/eas-build-job';
import chalk from 'chalk';

import { AppPlatform, SubmissionFragment, SubmissionStatus } from '../graphql/generated';
import Log, { link } from '../log';
import { appPlatformDisplayNames, appPlatformEmojis } from '../platform';
import AndroidSubmitCommand from './android/AndroidSubmitCommand';
import { SubmissionContext } from './context';
import IosSubmitCommand from './ios/IosSubmitCommand';
import { displayLogsAsync } from './utils/logs';
import { waitForSubmissionsEndAsync } from './utils/wait';

export async function submitAsync<T extends Platform>(
  ctx: SubmissionContext<T>
): Promise<SubmissionFragment> {
  const command =
    ctx.platform === Platform.ANDROID
      ? new AndroidSubmitCommand(ctx as SubmissionContext<Platform.ANDROID>)
      : new IosSubmitCommand(ctx as SubmissionContext<Platform.IOS>);
  return command.runAsync();
}

export async function waitToCompleteAsync(
  submissions: SubmissionFragment[],
  { verbose = false }: { verbose?: boolean } = {}
): Promise<void> {
  Log.newLine();
  const completedSubmissions = await waitForSubmissionsEndAsync(submissions);
  const moreSubmissions = completedSubmissions.length > 1;
  if (moreSubmissions) {
    Log.newLine();
  }
  for (const submission of completedSubmissions) {
    if (moreSubmissions) {
      Log.log(
        `${appPlatformEmojis[submission.platform]} ${chalk.bold(
          `${appPlatformDisplayNames[submission.platform]} submission`
        )}`
      );
    }
    if (submission.platform === AppPlatform.Android) {
      printInstructionsForAndroidSubmission(submission);
    } else {
      printInstructionsForIosSubmission(submission);
    }
    await displayLogsAsync(submission, { verbose, moreSubmissions });
    if (moreSubmissions) {
      Log.newLine();
    }
  }
  exitWithNonZeroCodeIfSomeSubmissionsDidntFinish(completedSubmissions);
}

function printInstructionsForAndroidSubmission(submission: SubmissionFragment): void {
  if (submission.status === SubmissionStatus.Finished) {
    Log.addNewLineIfNone();
    Log.log('All done!');
  }
}

function printInstructionsForIosSubmission(submission: SubmissionFragment): void {
  if (submission.status === SubmissionStatus.Finished) {
    const logMsg = [
      chalk.bold('Your binary has been successfully uploaded to App Store Connect!'),
      '- It is now being processed by Apple - you will receive an e-mail when the processing finishes.',
      '- It usually takes about 5-10 minutes depending on how busy Apple servers are.',
      // ascAppIdentifier should be always available for ios submissions but check it anyway
      submission.iosConfig?.ascAppIdentifier &&
        `- When it’s done, you can see your build here: ${link(
          `https://appstoreconnect.apple.com/apps/${submission.iosConfig?.ascAppIdentifier}/appstore/ios`
        )}`,
    ].join('\n');
    Log.addNewLineIfNone();
    Log.log(logMsg);
  }
}

function exitWithNonZeroCodeIfSomeSubmissionsDidntFinish(submissions: SubmissionFragment[]): void {
  const nonFinishedSubmissions = submissions.filter(
    ({ status }) => status !== SubmissionStatus.Finished
  );
  if (nonFinishedSubmissions.length > 0) {
    process.exit(1);
  }
}
