import { BetaFeedbackType } from './fetch';

/**
 * App Store Connect self-links, which are what EAS workflow triggers put in
 * `app_store_connect.beta_feedback.url`:
 *
 *   https://api.appstoreconnect.apple.com/v1/betaFeedbackCrashSubmissions/<id>
 *   https://api.appstoreconnect.apple.com/v1/betaFeedbackScreenshotSubmissions/<id>
 */
const FEEDBACK_URL_PATTERN =
  /\/(betaFeedbackCrashSubmissions|betaFeedbackScreenshotSubmissions)\/([^/?#]+)/i;

export type BetaFeedbackTarget = {
  id: string;
  type: BetaFeedbackType;
};

/**
 * Resolve a single submission to look up from what an EAS workflow trigger provides in
 * `app_store_connect.beta_feedback`: either the `url` (which encodes both `id` and `type`) or the
 * bare `id` alongside `type`. Without either, the command's own kind of feedback is assumed.
 */
export function resolveBetaFeedbackTarget({
  idOrUrl,
  type,
  defaultType,
}: {
  idOrUrl: string;
  type?: BetaFeedbackType;
  defaultType: BetaFeedbackType;
}): BetaFeedbackTarget {
  const match = idOrUrl.match(FEEDBACK_URL_PATTERN);
  if (match) {
    const urlType: BetaFeedbackType = match[1].toLowerCase().startsWith('betafeedbackcrash')
      ? 'crash'
      : 'screenshot';
    if (type && type !== urlType) {
      throw new Error(
        `--type ${type} does not match the URL, which points at ${urlType} feedback. Omit --type when passing a URL.`
      );
    }
    return { id: decodeURIComponent(match[2]), type: urlType };
  }

  if (/^[a-z][a-z\d+\-.]*:\/\//i.test(idOrUrl)) {
    throw new Error(
      `Could not tell whether "${idOrUrl}" points at crash or screenshot feedback. Pass the App Store Connect API URL from \${{ app_store_connect.beta_feedback.url }}, or pass the ID with --type.`
    );
  }

  return { id: idOrUrl, type: type ?? defaultType };
}
