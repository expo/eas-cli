#!/usr/bin/env node
import { ciCommand } from './commands/ci.js';
import { doctorCommand } from './commands/doctor.js';
import { initCommand } from './commands/init.js';
import { reviewCommand } from './commands/review.js';

const USAGE = `expo-code-review (ecr) — config-driven AI code reviewer

Usage:
  ecr review [options]   Review local changes (default). See \`ecr review --help\`.
  ecr ci                 Review the current PR and post a comment (GitHub Actions).
  ecr init [--with-workflow] [--force]   Scaffold .expo-code-review/ in this repo.
  ecr doctor             Check environment, config, and credentials.

Agents live in each repo under .expo-code-review/. This CLI is the engine.
`;

async function main(): Promise<void> {
  const [, , sub, ...rest] = process.argv;

  if (sub === '-h' || sub === '--help' || sub === 'help') {
    process.stdout.write(USAGE);
    return;
  }

  // No subcommand (or a leading flag) defaults to `review`.
  if (!sub || sub.startsWith('-')) {
    await reviewCommand(process.argv.slice(2));
    return;
  }

  switch (sub) {
    case 'review':
      await reviewCommand(rest);
      break;
    case 'ci':
      await ciCommand();
      break;
    case 'init':
      await initCommand(rest);
      break;
    case 'doctor':
      await doctorCommand();
      break;
    default:
      process.stderr.write(`Unknown command: ${sub}\n\n${USAGE}`);
      process.exitCode = 2;
  }
}

void main();
