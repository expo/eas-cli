import type { CoordinatorOutput } from '../core/schema.js';

/** A Reporter is where results go. The core produces a mode-agnostic result; the
 * Reporter decides how to render it. */
export interface Reporter {
  /** CI-only break-glass check; local reporters omit it (treated as false). */
  checkBreakGlass?(): Promise<boolean>;
  report(review: CoordinatorOutput): Promise<void>;
}
