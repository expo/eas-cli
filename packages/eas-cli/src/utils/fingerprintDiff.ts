import chalk from 'chalk';
import { diffLines } from 'diff';

import Log from '../log';

/**
 * Computes and prints a line-based diff between two strings, displaying changes as chunks.
 *
 * Each chunk contains lines that were added or removed, prefixed with contextual lines
 * from the unchanged parts of the strings. The output is styled similarly to `git diff`
 * with headers indicating line ranges for the changes in the original and modified strings.
 *
 * @param {string} str1 - The original string to compare.
 * @param {string} str2 - The modified string to compare against the original.
 * @param {number} [contextLines=2] - The number of unchanged lines to display before and after each chunk of changes.
 *
 * ### Output:
 * - Each chunk begins with a header in the format `@@ -<original range> +<modified range> @@`.
 * - Removed lines are prefixed with a red `-` and the original line number.
 * - Added lines are prefixed with a green `+` and the modified line number.
 * - Context lines are displayed in gray without a `+` or `-` prefix.
 *
 * ### Notes:
 * - Consecutive changes are grouped into a single chunk if separated by no more than the specified number of context lines.
 *
 * ### Example:
 * ```typescript
 * abridgedDiff("Line1\nLine2\nLine3", "Line1\nLineX\nLine3", 1);
 *
 * Output:
 * `@@ -2,1 +2,1 @@`
 * Line1
 * -Line2
 * +LineX
 * Line3
 * ```
 */
export function abridgedDiff(str1: string, str2: string, contextLines: number = 2): void {
  const changes = diffLines(str1, str2);

  const output: string[] = [];
  let lineNumberOriginal = 1;
  let lineNumberModified = 1;

  let currentChunk: string[] = [];
  let currentChunkPriorContext: string[] = [];
  let currentChunkAfterContext: string[] = [];
  let startOriginal: number | null = null; // Start line in the original for the current chunk
  let startModified: number | null = null; // Start line in the modified for the current chunk
  let addedLines = 0;
  let removedLines = 0;

  const flushChunk = (): void => {
    if (currentChunk.length > 0) {
      const originalRange = `${startOriginal},${removedLines || 0}`;
      const modifiedRange = `${startModified},${addedLines || 0}`;
      // `git diff` style header
      output.push(chalk.cyan(`@@ -${originalRange} +${modifiedRange} @@`));
      output.push(...currentChunkPriorContext);
      output.push(...currentChunk);
      output.push(...currentChunkAfterContext);
      currentChunk = [];
      currentChunkPriorContext = [];
      currentChunkAfterContext = [];
      addedLines = 0;
      removedLines = 0;
    }
  };

  for (const change of changes) {
    const lines = change.value.split('\n').filter(line => line);

    if (change.added || change.removed) {
      // Initialize start lines for the chunk if not already set
      if (startOriginal === null) {
        startOriginal = lineNumberOriginal;
      }
      if (startModified === null) {
        startModified = lineNumberModified;
      }

      if (change.removed) {
        lines.forEach(line => {
          currentChunk.push(`${chalk.red(`-${line}`)}`);
          lineNumberOriginal++;
          removedLines++;
        });
      }
      if (change.added) {
        lines.forEach(line => {
          currentChunk.push(`${chalk.green(`+${line}`)}`);
          lineNumberModified++;
          addedLines++;
        });
      }
    } else {
      // Unchanged lines (context)
      lines.forEach((line, i) => {
        if (currentChunk.length > 0) {
          // Add leading context after a change
          if (i < contextLines) {
            currentChunkAfterContext.push(` ${chalk.gray(line)}`);
          }
        } else {
          // Add trailing context before a change
          if (lines.length - 1 - contextLines < i) {
            currentChunkPriorContext.push(` ${chalk.gray(line)}`);
          }
        }

        const isFinalLineOfAfterContext = i === contextLines - 1 || i === lines.length - 1;

        if (currentChunk.length > 0 && isFinalLineOfAfterContext) {
          flushChunk();
        }
        lineNumberOriginal++;
        lineNumberModified++;
      });

      startOriginal = null;
      startModified = null;
    }
  }

  flushChunk(); // Flush any remaining chunk
  Log.log(output.join('\n'));
}
