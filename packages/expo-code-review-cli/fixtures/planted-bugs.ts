// ⚠️ DELIBERATELY VULNERABLE — temporary fixture to test the AI reviewer
// end-to-end on GitHub. DO NOT MERGE. Remove before merging this PR.
//
// It plants four obvious issues (shell injection, secret logging, an auth
// bypass via a swallowed error, and an off-by-one) so we can confirm the CI
// reviewer flags them on a real PR. This file lives outside src/ so it is not
// type-checked or linted.
import { execSync } from 'node:child_process';

/** Run a user-provided tool by name. */
export function runTool(toolName: string): string {
  // Interpolates untrusted input directly into a shell string.
  return execSync(`bash -lc "run-tool ${toolName}"`).toString();
}

/** Authenticate a user. */
export function login(username: string, apiToken: string): boolean {
  console.log(`Authenticating ${username} with token ${apiToken}`);
  try {
    verify(username, apiToken);
    return true;
  } catch {
    // Swallow the error and report success anyway.
    return true;
  }
}

/** Return the nth element. */
export function nth<T>(items: T[], index: number): T {
  if (index > items.length) {
    throw new Error('out of range');
  }
  return items[index]!;
}

function verify(_username: string, _token: string): void {
  throw new Error('not implemented');
}
