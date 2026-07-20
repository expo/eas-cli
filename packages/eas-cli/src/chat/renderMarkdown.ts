import chalk from 'chalk';
import wrapAnsi from 'wrap-ansi';

export function wrapToWidth(text: string, width: number): string[] {
  if (width < 10) {
    return [text];
  }
  return wrapAnsi(text, width, { hard: true, trim: false }).split('\n');
}

export type MarkdownRenderState = { inCodeBlock: boolean };

export function createMarkdownRenderState(): MarkdownRenderState {
  return { inCodeBlock: false };
}

const FENCE_REGEX = /^\s*```/;
const BULLET_REGEX = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED_REGEX = /^(\s*)(\d+)\.\s+(.*)$/;
const TERMINAL_CONTROL_CHARACTERS_REGEX = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

export function renderMarkdownLine(line: string, state: MarkdownRenderState): string | null {
  const sanitizedLine = line.replace(TERMINAL_CONTROL_CHARACTERS_REGEX, '');
  if (FENCE_REGEX.test(sanitizedLine)) {
    state.inCodeBlock = !state.inCodeBlock;
    return null;
  }
  if (state.inCodeBlock) {
    return chalk.gray(sanitizedLine);
  }

  const bullet = sanitizedLine.match(BULLET_REGEX);
  if (bullet) {
    return `${bullet[1]}${chalk.dim('•')} ${renderInlineMarkdown(bullet[2])}`;
  }

  const ordered = sanitizedLine.match(ORDERED_REGEX);
  if (ordered) {
    return `${ordered[1]}${chalk.dim(`${ordered[2]}.`)} ${renderInlineMarkdown(ordered[3])}`;
  }

  return renderInlineMarkdown(sanitizedLine);
}

export function renderInlineMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, (_match, code) => chalk.cyan(code))
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      (_match, label, url) => `${chalk.underline(label)} ${chalk.dim(`(${url})`)}`
    )
    .replace(/(\*\*|__)(.+?)\1/g, (_match, _marker, content) => chalk.bold(content));
}
