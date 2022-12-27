import { URL } from 'url';

import { getExpoWebsiteBaseUrl } from '../../api';
import { SubmissionFragment } from '../../graphql/generated';
import Log, { link } from '../../log';
import { appPlatformDisplayNames } from '../../platform';

export function printSubmissionDetailsUrls(submissions: SubmissionFragment[]): void {
  if (submissions.length === 1) {
    const [submission] = submissions;
    Log.log(`Submission details: ${link(getSubmissionDetailsUrl(submission))}`);
  } else {
    submissions.forEach(submission => {
      Log.log(
        `${appPlatformDisplayNames[submission.platform]} submission details: ${link(
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
