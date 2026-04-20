import { UserFacingError } from '@expo/eas-build-job/dist/errors';
import fs from 'fs-extra';
import path from 'path';

export function assertNoPodSchemeNameCollision({
  projectDir,
  buildScheme,
}: {
  projectDir: string;
  buildScheme: string;
}): void {
  const podSchemePath = path.join(
    projectDir,
    'ios',
    'Pods',
    'Pods.xcodeproj',
    'xcshareddata',
    'xcschemes',
    `${buildScheme}.xcscheme`
  );
  if (fs.existsSync(podSchemePath)) {
    throw new UserFacingError(
      'SCHEME_NAME_COLLISION',
      `Detected an iOS scheme name collision for "${buildScheme}".\n` +
        `A CocoaPods shared scheme with the same name exists at: ${podSchemePath}\n\n` +
        'This is unsafe because Xcode may resolve the Pods scheme instead of your application scheme.\n\n' +
        'To fix this:\n' +
        '- If you use CNG (managed workflow): create a non-conflicting iOS build scheme via a config plugin or prebuild script, then set "build.ios.scheme" in eas.json to that scheme.\n' +
        '- If you do not use CNG (native ios/ directory): rename the app scheme in Xcode so it does not match the Pod scheme name, then set "build.ios.scheme" in eas.json to that scheme.'
    );
  }
}
