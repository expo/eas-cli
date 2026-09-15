/**
 * What happens to the session when a task fails.
 *
 * - `fail-session`: the whole session fails. Running tasks are aborted and the
 *   job run errors with this task's error.
 * - `degrade-application`: the device stays usable. Tasks that need this one
 *   are skipped, the failure is logged, and the session continues.
 * - `warn`: the failure is logged and everything else proceeds as if the task
 *   had succeeded. Only for best-effort work such as cache warming.
 */
export type TaskFailurePolicy = 'fail-session' | 'degrade-application' | 'warn';

export type TaskOutcome = 'success' | 'failed' | 'skipped';

export interface TaskDefinition<TContext> {
  /** Stable snake_case id. Doubles as the log group id on expo.dev. */
  id: string;
  /** Human-readable name shown as the log group title. */
  displayName: string;
  /** Tasks that must succeed before this one starts. A failed or skipped need skips this task. */
  needs?: readonly string[];
  /** Tasks that must finish, with any outcome, before this one starts. */
  after?: readonly string[];
  onFailure: TaskFailurePolicy;
  run: (context: TContext) => Promise<void>;
}

export interface TaskResult {
  id: string;
  outcome: TaskOutcome;
  durationMs: number;
  error?: unknown;
  /** Why a task was skipped, for the log. */
  skipReason?: string;
}
