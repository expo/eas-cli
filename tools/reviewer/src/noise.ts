import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { DiffEntry, ReviewMetadata } from './schema.ts';

export interface FilteredFile {
  path: string;
  reason: string;
}

export interface NoiseResult {
  kept: DiffEntry[];
  filtered: FilteredFile[];
}

const LOCKFILES = new Set(['yarn.lock', 'package-lock.json', 'pnpm-lock.yaml', 'bun.lock']);
const NOISE_EXTENSIONS = ['.min.js', '.min.css', '.bundle.js', '.map'];

/**
 * Strip files that add no signal (lockfiles, generated bundles/maps, snapshots,
 * and files marked @generated) before any agent sees them. Everything removed is
 * returned in `filtered` so the run log stays auditable.
 */
export function filterNoise(entries: DiffEntry[]): NoiseResult {
  const kept: DiffEntry[] = [];
  const filtered: FilteredFile[] = [];

  for (const entry of entries) {
    const reason = noiseReason(entry);
    if (reason) {
      filtered.push({ path: entry.path, reason });
    } else {
      kept.push(entry);
    }
  }

  return { kept, filtered };
}

function noiseReason(entry: DiffEntry): string | null {
  const base = path.basename(entry.path);
  if (LOCKFILES.has(base)) {
    return 'lockfile';
  }
  for (const ext of NOISE_EXTENSIONS) {
    if (entry.path.endsWith(ext)) {
      return `generated asset (${ext})`;
    }
  }
  if (entry.path.includes('__snapshots__/') && entry.path.endsWith('.snap')) {
    return 'jest snapshot';
  }
  if (hasGenerationMarker(entry.patch)) {
    return 'contains @generated marker';
  }
  return null;
}

function hasGenerationMarker(patch: string): boolean {
  // Only inspect added lines near the top of the file.
  const addedLines = patch
    .split('\n')
    .filter(line => line.startsWith('+') && !line.startsWith('+++'))
    .slice(0, 10);
  return addedLines.some(line => /@generated|@codegen|do not edit/i.test(line));
}

export interface PatchWorkspaceFile {
  path: string;
  patchPath: string;
  status?: string;
}

export interface PatchWorkspace {
  root: string;
  manifestPath: string;
  files: PatchWorkspaceFile[];
}

/**
 * Write one patch file per changed file plus a shared manifest, all inside the
 * repo (so the OpenCode read tool can reach them). Agents are pointed at these
 * paths instead of having the full diff inlined into every prompt.
 */
export async function writePatchWorkspace(
  kept: DiffEntry[],
  metadata: ReviewMetadata,
  rootDir: string
): Promise<PatchWorkspace> {
  const patchDir = path.join(rootDir, 'patches');
  await mkdir(patchDir, { recursive: true });

  const files: PatchWorkspaceFile[] = [];
  for (let index = 0; index < kept.length; index++) {
    const entry = kept[index]!;
    // Prefix with the index so distinct paths that sanitize to the same string
    // can't collide and overwrite each other.
    const safeName = `${String(index).padStart(4, '0')}-${entry.path.replace(
      /[^a-zA-Z0-9._-]/g,
      '__'
    )}.patch`;
    const patchPath = path.join(patchDir, safeName);
    await writeFile(patchPath, entry.patch, 'utf8');
    files.push({ path: entry.path, patchPath, status: entry.status });
  }

  const manifestPath = path.join(rootDir, 'context.md');
  await writeFile(manifestPath, renderManifest(files, metadata), 'utf8');

  return { root: rootDir, manifestPath, files };
}

function renderManifest(files: PatchWorkspaceFile[], metadata: ReviewMetadata): string {
  const lines: string[] = [
    '# Changed files',
    '',
    `Base: ${metadata.baseRef || '(unknown)'}  Head: ${metadata.headRef || '(unknown)'}`,
    '',
    'Each entry lists the changed file (path relative to repo root) and a patch',
    'file containing its unified diff. Read the patch to see what changed, then',
    'read the surrounding source in the repo to confirm findings in context.',
    '',
  ];
  for (const file of files) {
    lines.push(`- \`${file.path}\` (${file.status ?? 'M'}) — patch: \`${file.patchPath}\``);
  }
  lines.push('');
  return lines.join('\n');
}
