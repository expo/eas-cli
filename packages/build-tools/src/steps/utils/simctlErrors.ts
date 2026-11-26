import { UserError } from '@expo/eas-build-job';

// simctl's IXUserPresentableErrorDomain message when the app's minimum iOS version is above the Simulator runtime.
const NEWER_IOS_REQUIRED_PATTERN =
  /^\s*(?:simctl install:\s*)?(?:App installation failed:\s*)?(?:""\s+)?Requires a Newer Version of iOS\s*$/m;

// simctl's IXUserPresentableErrorDomain (code=4) output when the app binary lacks a compatible simulator CPU architecture.
const FAILED_TO_FIND_MATCHING_ARCH_PATTERN =
  /^\s*(?:simctl install:\s*)?Failed to find matching arch\b/m;
const MISSING_PLATFORM_ARCH_COMBINATION_PATTERN =
  /^(?!\s*(?:simctl install:\s*)?(?:App installation failed:\s*)?Unable to Install\b).*does not contain code for any platform and CPU architecture combination\b/m;
const IX_USER_PRESENTABLE_CODE_4_PATTERN =
  /(?:domain=IXUserPresentableErrorDomain,\s+code=4\b|IXUserPresentableErrorDomain error 4\b)/;
const NEEDS_TO_BE_UPDATED_PATTERN =
  /^\s*(?:simctl install:\s*)?(?:App installation failed:\s*)?(?:""\s+)?Needs to Be Updated(?:\s|\(|$)/m;

// simctl's IXUserPresentableErrorDomain (code=6) output when the app does not support the Simulator's device family.
const INCOMPATIBLE_DEVICE_FAMILY_PATTERN =
  /^\s*(?:simctl install:\s*)?(?:This app is not made for this device\b|This app was not built to support this device family\b)/m;

// simctl openurl's LSApplicationWorkspaceErrorDomain (code=115) output when no installed app registers the URL scheme.
const SIMCTL_OPENURL_ECHO_LINE_PATTERN =
  /^\s*(?:simctl openurl:\s*)?Simulator device failed to open\b/;
const UNREGISTERED_URL_SCHEME_PATTERN =
  /(?:domain=LSApplicationWorkspaceErrorDomain,\s+code=115\b|LSApplicationWorkspaceErrorDomain error 115\b)/;

/**
 * Redacts quoted app display names (e.g. `Unable to Install “Example”`, `“Example” Needs to Be Updated`,
 * `“Example” Requires a Newer Version of iOS`) so user-controlled app titles cannot match or override
 * `simctl` diagnostic patterns.
 */
function stripQuotedAppNames(detail: string): string {
  return detail
    .split(/\r?\n/)
    .map(line =>
      line
        .replace(/“.*”/g, '""')
        .replace(
          /^(\s*(?:simctl install:\s*)?(?:App installation failed:\s*)?(?:Unable to Install\s+)?)"[^"]*"/,
          '$1""'
        )
    )
    .join('\n');
}

export function classifySimctlInstallError(detail: string, cause: unknown): UserError | undefined {
  const normalizedDetail = stripQuotedAppNames(detail);
  if (NEWER_IOS_REQUIRED_PATTERN.test(normalizedDetail)) {
    return new UserError(
      'EAS_INSTALL_APPLICATION_REQUIRES_NEWER_IOS',
      "This app requires a newer iOS version than the selected iOS Simulator runs. Choose an iOS Simulator device whose iOS version meets the app's minimum iOS version, or lower the app's iOS deployment target.",
      { cause }
    );
  }
  if (
    FAILED_TO_FIND_MATCHING_ARCH_PATTERN.test(normalizedDetail) ||
    MISSING_PLATFORM_ARCH_COMBINATION_PATTERN.test(normalizedDetail) ||
    (IX_USER_PRESENTABLE_CODE_4_PATTERN.test(normalizedDetail) &&
      NEEDS_TO_BE_UPDATED_PATTERN.test(normalizedDetail))
  ) {
    return new UserError(
      'EAS_INSTALL_APPLICATION_INCOMPATIBLE_ARCH',
      'This app binary does not contain a compatible iOS Simulator CPU architecture (for example, it may have been built for physical iOS devices or for Intel-only simulators instead of an Apple Silicon arm64 iOS Simulator). Rebuild the app for an iOS Simulator target matching the host architecture and try again.',
      { cause }
    );
  }
  if (INCOMPATIBLE_DEVICE_FAMILY_PATTERN.test(normalizedDetail)) {
    return new UserError(
      'EAS_INSTALL_APPLICATION_INCOMPATIBLE_DEVICE_FAMILY',
      "This app was not built to support the selected iOS Simulator device family. Choose an iOS Simulator device that matches the app's supported device family (for example, an iPad simulator for an iPad-only app), or rebuild the app to target iPhone/iPad iOS Simulators.",
      { cause }
    );
  }
  return undefined;
}

export function classifySimctlOpenUrlError(detail: string, cause: unknown): UserError | undefined {
  // Exclude the line where simctl echoes the user-supplied URL so query params cannot spoof code 115.
  const diagnosticLines = detail
    .split(/\r?\n/)
    .filter(line => !SIMCTL_OPENURL_ECHO_LINE_PATTERN.test(line))
    .join('\n');
  if (UNREGISTERED_URL_SCHEME_PATTERN.test(diagnosticLines)) {
    return new UserError(
      'EAS_LAUNCH_APPLICATION_UNREGISTERED_URL_SCHEME',
      'No installed app on the iOS Simulator registers the URL scheme specified in open_url. Make sure the app installed in this session declares that URL scheme in its Info.plist (CFBundleURLTypes) or update open_url to use a registered scheme.',
      { cause }
    );
  }
  return undefined;
}

export function getSpawnOutputDetail(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return '';
  }
  const { stderr, stdout } = error as { stderr?: unknown; stdout?: unknown };
  return [stderr, stdout]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join('\n');
}
