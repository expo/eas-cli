import { UserFacingError } from '@expo/eas-build-job/dist/errors';
import fs from 'fs-extra';
import path from 'path';

export async function assertNoPodSchemeNameCollisionAsync(
  projectRoot: string,
  scheme: string
): Promise<void> {
  const podSchemePath = path.join(
    projectRoot,
    'ios',
    'Pods',
    'Pods.xcodeproj',
    'xcshareddata',
    'xcschemes',
    `${scheme}.xcscheme`
  );
  if (await fs.pathExists(podSchemePath)) {
    throw new UserFacingError(
      'SCHEME_NAME_COLLISION',
      `Detected an iOS scheme name collision for "${scheme}".\n` +
        `A CocoaPods shared scheme with the same name exists at: ${podSchemePath}\n\n` +
        'This is unsafe because Xcode may resolve the Pods scheme instead of your application scheme.\n\n' +
        'To fix this:\n' +
        '- If you use CNG: set "ios.scheme" in eas.json to a non-conflicting app scheme name.\n' +
        "- If you don't use CNG: rename the app scheme in Xcode so it does not match the Pod scheme name, then update build config to use that scheme."
    );
  }
}
