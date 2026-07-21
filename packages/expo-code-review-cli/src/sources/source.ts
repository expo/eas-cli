import type { DiffEntry, ReviewMetadata } from '../core/schema.js';

/**
 * A Source is where the diff comes from. CI and local mode differ only in which
 * Source (and Reporter) is wired into the otherwise-identical review core.
 */
export interface ReviewSource {
  getMetadata(): Promise<ReviewMetadata>;
  /** Changed files as path + patch text per file. */
  getChangedFiles(): Promise<DiffEntry[]>;
}
