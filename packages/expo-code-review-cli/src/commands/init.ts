import { cp, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONFIG_DIRNAME } from '../config/load.js';
import { repoRoot } from '../core/exec.js';

const TEMPLATES_DIR = fileURLToPath(new URL('../../templates/', import.meta.url));

const USAGE = `ecr init — scaffold .expo-code-review/ in the current repo

Usage:
  ecr init [--with-workflow] [--force]

Options:
  --with-workflow   Also write .github/workflows/expo-code-review.yml
  --force           Overwrite existing files
  -h, --help        Show this help
`;

export async function initCommand(argv: string[]): Promise<void> {
  if (argv.includes('-h') || argv.includes('--help')) {
    process.stdout.write(USAGE);
    return;
  }
  try {
    await scaffold(argv);
  } catch (error) {
    process.stderr.write(`init failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}

/** Scaffold .expo-code-review/ (and optionally the CI workflow) into the repo. */
async function scaffold(argv: string[]): Promise<void> {
  const force = argv.includes('--force');
  const withWorkflow = argv.includes('--with-workflow');

  const root = (await repoRoot()) ?? process.cwd();
  const configDir = path.join(root, CONFIG_DIRNAME);
  // Create only the config dir; let copyInto create prompts/ so it reports
  // accurately as created vs skipped.
  await mkdir(configDir, { recursive: true });

  const created: string[] = [];
  const skipped: string[] = [];

  await copyInto(path.join(TEMPLATES_DIR, 'config.jsonc'), path.join(configDir, 'config.jsonc'), force, created, skipped, root);
  await copyInto(path.join(TEMPLATES_DIR, 'shared.md'), path.join(configDir, 'shared.md'), force, created, skipped, root);
  await copyInto(path.join(TEMPLATES_DIR, 'coordinator.md'), path.join(configDir, 'coordinator.md'), force, created, skipped, root);
  await copyInto(path.join(TEMPLATES_DIR, 'agents'), path.join(configDir, 'agents'), force, created, skipped, root);

  const gitignorePath = path.join(configDir, '.gitignore');
  if (force || !existsSync(gitignorePath)) {
    await writeFile(gitignorePath, '.runs/\n', 'utf8');
    created.push(path.relative(root, gitignorePath));
  } else {
    skipped.push(path.relative(root, gitignorePath));
  }

  if (withWorkflow) {
    const workflowDir = path.join(root, '.github', 'workflows');
    await mkdir(workflowDir, { recursive: true });
    await copyInto(
      path.join(TEMPLATES_DIR, 'workflow.yml'),
      path.join(workflowDir, 'expo-code-review.yml'),
      force,
      created,
      skipped,
      root
    );
  }

  for (const file of created) {
    process.stdout.write(`  created  ${file}\n`);
  }
  for (const file of skipped) {
    process.stdout.write(`  skipped  ${file} (exists; use --force to overwrite)\n`);
  }
  process.stdout.write(
    [
      '',
      'Next steps:',
      `  1. Customize ${CONFIG_DIRNAME}/agents/*.md (and shared.md, coordinator.md) for this repo.`,
      '  2. Configure a model provider in OpenCode (or set REVIEWER_MODEL).',
      '  3. Run `ecr doctor`, then `ecr review`.',
      withWorkflow
        ? '  4. Add the model-key secret referenced by the workflow.'
        : '  4. Run `ecr init --with-workflow` to add the CI workflow.',
      '',
    ].join('\n')
  );
}

async function copyInto(
  src: string,
  dest: string,
  force: boolean,
  created: string[],
  skipped: string[],
  root: string
): Promise<void> {
  const existed = existsSync(dest);
  await cp(src, dest, { recursive: true, force, errorOnExist: false });
  (existed && !force ? skipped : created).push(path.relative(root, dest));
}
