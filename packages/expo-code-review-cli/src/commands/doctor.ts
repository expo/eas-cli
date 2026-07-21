import { loadReviewConfig, hasConfig } from '../config/load.js';
import { onPath, repoRoot } from '../core/exec.js';

/** Preflight checks so a broken setup surfaces clearly instead of silently no-opping. */
export async function doctorCommand(): Promise<void> {
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

  if (!hasConfig(root)) {
    line(false, `no ${'.expo-code-review'}/config.jsonc (run \`ecr init\`)`);
  } else {
    try {
      const config = await loadReviewConfig(root);
      line(true, `config valid: ${config.agents.length} agent(s) [${config.agents.map(a => a.id).join(', ')}], coordinator model ${config.coordinator.model}`);
      line(
        config.agents.every(a => Boolean(a.promptText.trim())),
        'all agent prompt files resolved and non-empty'
      );
    } catch (error) {
      line(false, `config invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const hasModelEnv =
    Boolean(process.env.REVIEWER_MODEL) ||
    Boolean(process.env.ANTHROPIC_API_KEY) ||
    Boolean(process.env.OPENAI_API_KEY);
  line(
    hasModelEnv,
    hasModelEnv
      ? 'a model credential/override is present in the environment'
      : 'no obvious model credential in env — ensure OpenCode is authenticated or set REVIEWER_MODEL + provider key'
  );

  process.stdout.write(ok ? '\nAll good.\n' : '\nIssues found (see ✗ above).\n');
  process.exitCode = ok ? 0 : 1;
}
