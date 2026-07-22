import { loadReviewConfig, hasConfig } from '../config/load.js';
import { onPath, repoRoot, run } from '../core/exec.js';
import { errorMessage } from '../core/util.js';

const USAGE = `ecr doctor — check environment, config, and credentials

Usage:
  ecr doctor

Verifies: opencode + git (+ gh for \`ecr ci\`) on PATH, .expo-code-review/ config is
valid, agent prompts resolve, and the configured model's token env is set.
`;

/** Preflight checks so a broken setup surfaces clearly instead of silently no-opping. */
export async function doctorCommand(argv: string[] = []): Promise<void> {
  if (argv.includes('-h') || argv.includes('--help')) {
    process.stdout.write(USAGE);
    return;
  }
  const root = (await repoRoot()) ?? process.cwd();
  let ok = true;
  const line = (pass: boolean, message: string): void => {
    if (!pass) {
      ok = false;
    }
    process.stdout.write(`  ${pass ? '✓' : '✗'} ${message}\n`);
  };

  process.stdout.write(`expo-code-review doctor (repo: ${root})\n`);

  const opencodeInstalled = await onPath('opencode');
  line(
    opencodeInstalled,
    opencodeInstalled
      ? 'opencode CLI found on PATH'
      : 'opencode CLI NOT on PATH (install `opencode-ai`, or add node_modules/.bin to PATH)'
  );

  line(await onPath('git'), 'git found on PATH');

  // `gh` is only needed for `ecr ci` (posting PR comments), so treat it as
  // informational (ℹ) rather than a hard failure for local `ecr review` users.
  const info = (message: string): void => {
    process.stdout.write(`  ℹ ${message}\n`);
  };
  if (await onPath('gh')) {
    let authed = false;
    try {
      await run('gh', ['auth', 'status'], { cwd: root });
      authed = true;
    } catch {
      authed = false;
    }
    if (authed) {
      line(true, 'gh CLI found and authenticated (used by `ecr ci`)');
    } else {
      info('gh CLI found but not authenticated — run `gh auth login` before `ecr ci`');
    }
  } else {
    info('gh CLI not on PATH — only needed for `ecr ci` (posting PR comments)');
  }

  if (!hasConfig(root)) {
    line(false, `no ${'.expo-code-review'}/config.jsonc (run \`ecr init\`)`);
  } else {
    try {
      const config = await loadReviewConfig(root);
      line(
        true,
        `config valid: ${config.agents.length} agent(s) [${config.agents.map(a => a.id).join(', ')}], coordinator model ${config.coordinator.model}`
      );
      line(
        config.agents.every(a => Boolean(a.promptText.trim())),
        'all agent prompt files resolved and non-empty'
      );

      const { mode, provider, tokenEnv } = config.auth;
      if (tokenEnv) {
        const present = Boolean(process.env[tokenEnv]);
        line(
          present,
          present
            ? `auth: ${mode} for ${provider}; token env ${tokenEnv} is set`
            : `auth: ${mode} for ${provider}; token env ${tokenEnv} is NOT set`
        );
      } else {
        line(
          true,
          `auth: ${mode} for ${provider}; no tokenEnv configured — relying on OpenCode's own login or REVIEWER_MODEL`
        );
      }
    } catch (error) {
      line(false, `config invalid: ${errorMessage(error)}`);
    }
  }

  process.stdout.write(ok ? '\nAll good.\n' : '\nIssues found (see ✗ above).\n');
  process.exitCode = ok ? 0 : 1;
}
