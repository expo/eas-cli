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

const FENCE_RE = /^\s*```/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BLOCKQUOTE_RE = /^\s*>\s?(.*)$/;
const HORIZONTAL_RULE_RE = /^\s*([-*_])\1{2,}\s*$/;
const BULLET_RE = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED_RE = /^(\s*)(\d+)\.\s+(.*)$/;

export function renderMarkdownLine(line: string, state: MarkdownRenderState): string | null {
  if (FENCE_RE.test(line)) {
    state.inCodeBlock = !state.inCodeBlock;
    return null;
  }
  if (state.inCodeBlock) {
    return chalk.gray(line);
  }

  const heading = line.match(HEADING_RE);
  if (heading) {
    return chalk.bold(renderInlineMarkdown(heading[2]));
  }

  if (HORIZONTAL_RULE_RE.test(line)) {
    return chalk.dim('─'.repeat(24));
  }

  const blockquote = line.match(BLOCKQUOTE_RE);
  if (blockquote) {
    return chalk.dim(`│ ${renderInlineMarkdown(blockquote[1])}`);
  }

  const bullet = line.match(BULLET_RE);
  if (bullet) {
    return `${bullet[1]}${chalk.dim('•')} ${renderInlineMarkdown(bullet[2])}`;
  }

  const ordered = line.match(ORDERED_RE);
  if (ordered) {
    return `${ordered[1]}${chalk.dim(`${ordered[2]}.`)} ${renderInlineMarkdown(ordered[3])}`;
  }

  return renderInlineMarkdown(line);
}

export function renderInlineMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, (_match, code) => chalk.cyan(code))
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      (_match, label, url) => `${chalk.underline(label)} ${chalk.dim(`(${url})`)}`
    )
    .replace(/(\*\*|__)(.+?)\1/g, (_match, _marker, content) => chalk.bold(content))
    .replace(/(?<!\*)\*(?!\s)([^*\n]+?)\*(?!\*)/g, (_match, content) => chalk.italic(content))
    .replace(/(?<![A-Za-z0-9_])_(?!\s)([^_\n]+?)_(?![A-Za-z0-9_])/g, (_match, content) =>
      chalk.italic(content)
    );
}
