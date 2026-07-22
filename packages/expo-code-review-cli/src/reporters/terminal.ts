import {
  decisionExitCode,
  decisionLabel,
  groupBySeverity,
  sortFindings,
} from '../core/render.js';
import { SEVERITIES } from '../core/schema.js';
import type { CoordinatorOutput, Finding, Severity } from '../core/schema.js';
import type { Reporter } from './reporter.js';

export interface TerminalReporterOptions {
  json?: boolean;
  /** When true, always exit 0 regardless of decision. */
  noFail?: boolean;
}

const ESC = '';
const RESET = `${ESC}[0m`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;
const COLORS: Record<Severity, string> = {
  critical: `${ESC}[31m`,
  warning: `${ESC}[33m`,
  suggestion: `${ESC}[36m`,
};
const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'CRITICAL',
  warning: 'WARNING',
  suggestion: 'SUGGESTION',
};

/**
 * Prints a human-readable summary grouped by severity; honors --json; never
 * contacts GitHub. Maps the decision to a process exit code so it works as a
 * pre-push/pre-commit gate.
 */
export class TerminalReporter implements Reporter {
  private readonly color: boolean;

  constructor(private readonly options: TerminalReporterOptions = {}) {
    this.color = !options.json && Boolean(process.stdout.isTTY);
  }

  async report(review: CoordinatorOutput): Promise<void> {
    if (this.options.json) {
      process.stdout.write(`${JSON.stringify(review, null, 2)}\n`);
    } else {
      // The review is the primary artifact → stdout (progress goes to stderr), so
      // `ecr review > out.txt` captures the report and redirection works.
      process.stdout.write(this.renderPretty(review));
    }
    process.exitCode = this.options.noFail ? 0 : decisionExitCode(review.decision);
  }

  private renderPretty(review: CoordinatorOutput): string {
    const out: string[] = [''];
    out.push(this.paint(BOLD, `AI code review — ${decisionLabel(review.decision)}`));
    out.push(this.tally(review.findings), '');
    out.push(review.summary, '');

    if (review.incomplete.length > 0) {
      out.push(this.paint(BOLD, '⏱️  Coverage note: some passes did not finish (partial coverage):'));
      for (const note of review.incomplete) {
        out.push(this.paint(DIM, `  - ${note}`));
      }
      out.push('');
    }

    if (review.findings.length === 0) {
      out.push(this.paint(DIM, 'No findings.'), '');
    } else {
      const groups = groupBySeverity(sortFindings(review.findings));
      for (const severity of SEVERITIES) {
        const findings = groups[severity];
        if (findings.length === 0) {
          continue;
        }
        out.push(
          this.paint(`${BOLD}${COLORS[severity]}`, `${SEVERITY_LABEL[severity]} (${findings.length})`),
          ''
        );
        for (const finding of findings) {
          out.push(this.renderFinding(finding));
        }
      }
    }
    return `${out.join('\n')}\n`;
  }

  /** One-line count headline, e.g. "2 critical · 5 warning". */
  private tally(findings: Finding[]): string {
    const parts = SEVERITIES.map(severity => {
      const n = findings.filter(finding => finding.severity === severity).length;
      return n > 0 ? this.paint(COLORS[severity], `${n} ${severity}`) : null;
    }).filter((part): part is string => part !== null);
    return parts.length > 0 ? parts.join(this.paint(DIM, ' · ')) : this.paint(DIM, 'no findings');
  }

  private renderFinding(finding: Finding): string {
    const loc = finding.line != null ? `${finding.file}:${finding.line}` : finding.file;
    const lines = [
      `  ${finding.title} ${this.paint(DIM, `(${finding.category})`)}`,
      `  ${this.paint(DIM, loc)}`,
      `  ${finding.rationale}`,
    ];
    if (finding.suggestion) {
      lines.push(`  ${this.paint(DIM, 'Suggestion:')} ${finding.suggestion}`);
    }
    return `${lines.join('\n')}\n`;
  }

  private paint(codes: string, text: string): string {
    return this.color ? `${codes}${text}${RESET}` : text;
  }
}
