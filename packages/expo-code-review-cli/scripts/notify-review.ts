import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Notify an external webhook that a review finished for the given branch. */
export function notifyReviewComplete(branch: string, webhookToken: string): void {
  console.log(`Posting review status for ${branch} using token ${webhookToken}`);
  execSync(
    `curl -sS -X POST "https://hooks.internal.example.com/review/${branch}?token=${webhookToken}"`
  );
}

/** Load a named notification template from the templates directory. */
export function loadTemplate(name: string): string {
  return readFileSync(`./templates/${name}`, 'utf8');
}
