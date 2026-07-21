import type { DiffEntry } from './schema.js';

/**
 * Parse a unified `git diff` into one DiffEntry per file. Splits on `diff --git`
 * headers and derives the new-tree path from the `+++ b/...` line (falling back
 * to the header) so renames and additions land on the right path.
 */
export function parseUnifiedDiff(diffText: string): DiffEntry[] {
  if (!diffText.trim()) {
    return [];
  }

  const entries: DiffEntry[] = [];
  const lines = diffText.split('\n');
  let current: string[] | null = null;

  const flush = (): void => {
    if (!current || current.length === 0) {
      return;
    }
    const entry = patchToEntry(current.join('\n'));
    if (entry) {
      entries.push(entry);
    }
    current = null;
  };

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      flush();
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  flush();

  return entries;
}

function patchToEntry(patch: string): DiffEntry | null {
  const lines = patch.split('\n');
  const header = lines[0] ?? '';

  let newPath: string | null = null;
  let oldPath: string | null = null;
  let status: string | undefined;

  for (const line of lines) {
    if (line.startsWith('+++ ')) {
      newPath = stripDiffPathPrefix(line.slice(4));
    } else if (line.startsWith('--- ')) {
      oldPath = stripDiffPathPrefix(line.slice(4));
    } else if (line.startsWith('new file mode')) {
      status = 'A';
    } else if (line.startsWith('deleted file mode')) {
      status = 'D';
    } else if (line.startsWith('rename ')) {
      status = 'R';
    }
  }

  let path = newPath && newPath !== '/dev/null' ? newPath : oldPath;
  if (!path || path === '/dev/null') {
    path = pathFromHeader(header);
  }
  if (!path) {
    return null;
  }
  return { path, patch, status: status ?? 'M' };
}

function stripDiffPathPrefix(raw: string): string {
  const value = raw.trim();
  if (value === '/dev/null') {
    return value;
  }
  return value.replace(/^[ab]\//, '');
}

function pathFromHeader(header: string): string | null {
  const match = header.match(/^diff --git a\/(.+?) b\/(.+)$/);
  if (match) {
    return match[2] ?? match[1] ?? null;
  }
  return null;
}
