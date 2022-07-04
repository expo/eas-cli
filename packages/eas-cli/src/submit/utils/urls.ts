import chalk from 'chalk';
import { URL } from 'url';

import { getExpoWebsiteBaseUrl } from '../../api.js';
import { SubmissionFragment } from '../../graphql/generated.js';
import Log from '../../log.js';
import { appPlatformDisplayNames } from '../../platform.js';

export function printSubmissionDetailsUrls(submissions: SubmissionFragment[]): void {
  if (submissions.length === 1) {
    const [submission] = submissions;
    Log.log(`Submission details: ${chalk.underline(getSubmissionDetailsUrl(submission))}`);
  } else {
    submissions.forEach(submission => {
      Log.log(
        `${appPlatformDisplayNames[submission.platform]} submission details: ${chalk.underline(
          getSubmissionDetailsUrl(submission)
        )}`
      );
    });
  }
}

export function getSubmissionDetailsUrl(submission: SubmissionFragment): string {
  const { id, app } = submission;
  return new URL(
    `/accounts/${app.ownerAccount.name}/projects/${app.slug}/submissions/${id}`,
    getExpoWebsiteBaseUrl()
  ).toString();
}
