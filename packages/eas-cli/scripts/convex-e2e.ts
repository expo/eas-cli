import { spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

/*
 * Manual Convex integration E2E runner.
 *
 * Run from packages/eas-cli with:
 *   yarn ts-node scripts/convex-e2e.ts
 *
 * This uses the deployed EAS API and real authenticated EAS/Convex-backed
 * resources. Cleanup removes EAS-side links when possible, but it does not
 * destroy Convex-side resources.
 *
 * Options:
 *   CONVEX_E2E_KEEP_PROJECT=1 keeps the temp Expo project and skips cleanup.
 *   CONVEX_E2E_SKIP_DASHBOARD=1 skips opening the Convex dashboard.
 *   CONVEX_E2E_ACCOUNT=<account-name> sets the Expo app owner before eas init.
 */

type RunOptions = {
  cwd?: string;
  allowFailure?: boolean;
  env?: NodeJS.ProcessEnv;
};

type RunResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

const KEEP_PROJECT = process.env.CONVEX_E2E_KEEP_PROJECT === '1';
const SKIP_DASHBOARD = process.env.CONVEX_E2E_SKIP_DASHBOARD === '1';
const ACCOUNT = process.env.CONVEX_E2E_ACCOUNT;
const SCRIPT_DIR = __dirname;
const EAS_CLI_ROOT = path.resolve(SCRIPT_DIR, '..');
const LOCAL_EAS_BIN = path.join(EAS_CLI_ROOT, 'bin', 'run');
const TEMP_ROOT_PREFIX = path.join(os.tmpdir(), 'eas-cli-convex-e2e-');

let tempRoot: string | null = null;
let projectDir: string | null = null;
let initializedProject = false;
let initialConvexTeamSlugs: string[] = [];
let createdConvexTeamSlug: string | null = null;

async function mainAsync(): Promise<void> {
  try {
    await assertFileExistsAsync(
      LOCAL_EAS_BIN,
      `Local EAS CLI binary not found at ${LOCAL_EAS_BIN}`
    );
    await runEasAsync(['whoami']);

    const testName = `convex-e2e-${Date.now().toString(36)}`;
    tempRoot = await fs.mkdtemp(TEMP_ROOT_PREFIX);
    projectDir = path.join(tempRoot, testName);

    logStep(`Creating fresh Expo project ${testName}`);
    await runAsync('npx', ['--yes', 'create-expo-app@latest', projectDir, '--template', 'blank'], {
      cwd: tempRoot,
      env: getNpxEnvironment(),
    });

    await updateAppJsonAsync(projectDir, testName);

    logStep('Creating/linking EAS project');
    await runEasAsync(['init', '--non-interactive', '--force'], projectDir);
    initializedProject = true;

    initialConvexTeamSlugs = parseConvexTeamSlugs(
      (await runEasAsync(['integrations:convex:team'], projectDir)).stdout
    );

    logStep('Connecting Convex');
    await runEasAsync(
      ['integrations:convex:connect', '--non-interactive', '--project-name', testName],
      projectDir
    );

    await assertEnvLocalAsync(projectDir);
    await assertPackageJsonDependencyAsync(projectDir, 'convex');

    const teamOutput = await runEasAsync(['integrations:convex:team'], projectDir);
    const projectOutput = await runEasAsync(['integrations:convex:project'], projectDir);
    assertIncludes(
      projectOutput.stdout,
      'Dashboard',
      'Expected project output to include dashboard'
    );

    const teamSlugsAfterConnect = parseConvexTeamSlugs(teamOutput.stdout);
    const newTeamSlugs = teamSlugsAfterConnect.filter(
      slug => !initialConvexTeamSlugs.includes(slug)
    );
    createdConvexTeamSlug = newTeamSlugs[0] ?? null;
    const convexTeamSlug = createdConvexTeamSlug ?? teamSlugsAfterConnect[0];

    if (!convexTeamSlug) {
      throw new Error('Could not determine a Convex team slug from team output.');
    }

    await runEasAsync(
      ['integrations:convex:team:invite', convexTeamSlug, '--non-interactive'],
      projectDir
    );

    if (SKIP_DASHBOARD) {
      logStep('Skipping dashboard command because CONVEX_E2E_SKIP_DASHBOARD=1');
    } else {
      await runEasAsync(['integrations:convex:dashboard'], projectDir);
    }

    logStep('Convex E2E flow completed successfully');
  } finally {
    await cleanupAsync();
  }
}

async function cleanupAsync(): Promise<void> {
  if (!projectDir || !tempRoot) {
    return;
  }

  if (KEEP_PROJECT) {
    logStep('Skipping cleanup because CONVEX_E2E_KEEP_PROJECT=1');
    log(`Temp project kept at: ${projectDir}`);
    log('EAS-side links and Convex-side resources were left intact.');
    return;
  }

  if (initializedProject) {
    logStep('Cleaning up EAS-side Convex links');
    const convexTeamSlugToDelete =
      createdConvexTeamSlug ?? (await getCreatedConvexTeamSlugForCleanupAsync());

    await runCleanupCommandAsync([
      'integrations:convex:project:delete',
      '--non-interactive',
      '--yes',
    ]);

    if (convexTeamSlugToDelete) {
      await runCleanupCommandAsync([
        'integrations:convex:team:delete',
        convexTeamSlugToDelete,
        '--non-interactive',
        '--yes',
      ]);
    } else {
      warn(
        'No newly-created Convex team link was detected. Skipping team link deletion to avoid removing a pre-existing EAS-side link.'
      );
    }

    warn('Convex-side resources are not destroyed by this cleanup.');
  }

  await fs.rm(tempRoot, { recursive: true, force: true });
  log(`Removed temp project directory: ${tempRoot}`);
}

async function getCreatedConvexTeamSlugForCleanupAsync(): Promise<string | null> {
  if (!projectDir) {
    return null;
  }
  const result = await runEasAsync(['integrations:convex:team'], projectDir, {
    allowFailure: true,
  });
  if (result.exitCode !== 0) {
    warn('Could not inspect Convex team links during cleanup.');
    return null;
  }
  return (
    parseConvexTeamSlugs(result.stdout).find(slug => !initialConvexTeamSlugs.includes(slug)) ?? null
  );
}

async function runCleanupCommandAsync(args: string[]): Promise<void> {
  try {
    const result = await runEasAsync(args, projectDir ?? undefined, { allowFailure: true });
    if (result.exitCode !== 0) {
      warn(`Cleanup command exited with ${result.exitCode}: ${args.join(' ')}`);
    }
  } catch (error) {
    warn(`Cleanup command failed: ${args.join(' ')}`);
    warn(error instanceof Error ? error.message : String(error));
  }
}

async function runEasAsync(
  args: string[],
  cwd?: string,
  options: RunOptions = {}
): Promise<RunResult> {
  return await runAsync(LOCAL_EAS_BIN, args, { cwd, ...options });
}

async function runAsync(
  command: string,
  args: string[],
  { cwd, allowFailure = false, env = {} }: RunOptions = {}
): Promise<RunResult> {
  const printableCommand = [command, ...args].join(' ');
  log(`\n$ ${printableCommand}`);
  if (cwd) {
    log(`cwd: ${cwd}`);
  }

  return await new Promise<RunResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        ...env,
        CI: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', data => {
      const chunk = data.toString();
      stdout += chunk;
      process.stdout.write(redact(chunk));
    });

    child.stderr.on('data', data => {
      const chunk = data.toString();
      stderr += chunk;
      process.stderr.write(redact(chunk));
    });

    child.on('error', reject);
    child.on('close', exitCode => {
      const result = { stdout, stderr, exitCode };
      if (!allowFailure && exitCode !== 0) {
        reject(new Error(`Command failed with exit code ${exitCode}: ${printableCommand}`));
        return;
      }
      resolve(result);
    });
  });
}

async function updateAppJsonAsync(appDir: string, testName: string): Promise<void> {
  const appJsonPath = path.join(appDir, 'app.json');
  const rawAppJson = await fs.readFile(appJsonPath, 'utf8');
  const appJson = JSON.parse(rawAppJson);
  appJson.expo = {
    ...appJson.expo,
    name: testName,
    slug: testName,
    ...(ACCOUNT ? { owner: ACCOUNT } : {}),
  };
  await fs.writeFile(appJsonPath, `${JSON.stringify(appJson, null, 2)}\n`);
}

async function assertEnvLocalAsync(appDir: string): Promise<void> {
  const envLocalPath = path.join(appDir, '.env.local');
  const envLocal = await fs.readFile(envLocalPath, 'utf8');
  assertIncludes(
    envLocal,
    'CONVEX_DEPLOY_KEY=',
    'Expected .env.local to contain CONVEX_DEPLOY_KEY'
  );
  assertIncludes(
    envLocal,
    'EXPO_PUBLIC_CONVEX_URL=',
    'Expected .env.local to contain EXPO_PUBLIC_CONVEX_URL'
  );
  log('\nVerified .env.local contains Convex environment variables:');
  log(redact(envLocal));
}

async function assertPackageJsonDependencyAsync(
  appDir: string,
  packageName: string
): Promise<void> {
  const packageJsonPath = path.join(appDir, 'package.json');
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  if (!dependencies[packageName]) {
    throw new Error(`Expected package.json to include ${packageName}`);
  }
  log(`Verified package.json includes ${packageName}@${dependencies[packageName]}`);
}

function parseConvexTeamSlugs(output: string): string[] {
  const strippedOutput = stripAnsi(output);
  return Array.from(strippedOutput.matchAll(/^Team:\s+.+?\s\/\s(.+)$/gm), match => match[1].trim());
}

function assertIncludes(value: string, expected: string, message: string): void {
  if (!value.includes(expected)) {
    throw new Error(message);
  }
}

async function assertFileExistsAsync(filePath: string, message: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(message);
  }
}

function logStep(message: string): void {
  log(`\n==> ${message}`);
}

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

function warn(message: string): void {
  process.stderr.write(`${message}\n`);
}

function redact(value: string): string {
  return value
    .replace(/^CONVEX_DEPLOY_KEY=.*$/gm, 'CONVEX_DEPLOY_KEY=<redacted>')
    .replace(/dev:[^\s|]+\|[^\s]+/g, 'dev:<redacted>');
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

function getNpxEnvironment(): NodeJS.ProcessEnv {
  return {
    npm_config_user_agent: `npm/10 node/${process.versions.node} ${process.platform} ${process.arch}`,
    npm_execpath: undefined,
  };
}

mainAsync().catch(error => {
  warn(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
