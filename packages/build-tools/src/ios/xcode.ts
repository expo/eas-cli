import { SystemError } from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';

export async function getXcodeVersionAsync({ env }: { env: NodeJS.ProcessEnv }): Promise<string> {
  const { stdout } = await spawn('xcodebuild', ['-version'], { stdio: 'pipe', env });
  const version = /^Xcode\s+(\d+(?:\.\d+)*)$/m.exec(stdout)?.[1];
  if (!version) {
    throw new SystemError(`Failed to determine Xcode version from: ${stdout.trim()}`);
  }
  return version;
}
