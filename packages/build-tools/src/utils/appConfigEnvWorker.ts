import { get } from '@expo/env';

export function runAppConfigEnvWorker(projectDir: string): void {
  const { env } = get(projectDir, { force: true, silent: true });
  process.stdout.write(JSON.stringify(env));
}

if (require.main === module) {
  const projectDir = process.argv[2];
  if (!projectDir) {
    process.stderr.write('The project directory is required to load production dotenv files.\n');
    process.exitCode = 1;
  } else {
    try {
      runAppConfigEnvWorker(projectDir);
    } catch {
      process.stderr.write('Failed to load the production dotenv files.\n');
      process.exitCode = 1;
    }
  }
}
