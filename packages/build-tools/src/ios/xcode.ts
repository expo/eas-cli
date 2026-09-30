import { SystemError } from '@expo/eas-build-job';
import spawn from '@expo/turtle-spawn';

export async function getXcodeVersionAsync({ env }: { env: NodeJS.ProcessEnv }): Promise<string> {
  let stdout: string;
  try {
    ({ stdout } = await spawn('xcodebuild', ['-version'], { stdio: 'pipe', env }));
  } catch (error) {
    throw new SystemError('Failed to get Xcode version', { cause: error });
  }
  const version = /^Xcode\s+(\d+(?:\.\d+)*)$/m.exec(stdout)?.[1];
  if (!version) {
    throw new SystemError(`Failed to determine Xcode version from: ${stdout.trim()}`);
  }
  return version;
}
