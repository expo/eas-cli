import chalk from 'chalk';
import wrapAnsi from 'wrap-ansi';

/**
 * Wraps a (possibly ANSI-styled) line to `width` visible columns, returning one string per physical
 * line. `hard` breaks tokens longer than the width (e.g. URLs) so they wrap too. Returns the line
 * unchanged when the width is too small to wrap into (e.g. output is not a terminal).
 */
export function wrapToWidth(text: string, width: number): string[] {
  if (width < 10) {
    return [text];
  }
  return wrapAnsi(text, width, { hard: true, trim: false }).split('\n');
}

/**
 * Minimal, streaming-friendly markdown-to-ANSI rendering for the terminal. The assistant streams
 * markdown token by token, so rendering happens one completed line at a time (markers never span
 * lines except fenced code blocks, which we track with `MarkdownRenderState`).
 *
 * This intentionally supports only the common elements the assistant produces; it is not a full
 * CommonMark implementation.
 */
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

/**
 * Renders a single line of markdown to an ANSI-styled string. Returns `null` when the line should
 * be dropped from the output (the ``` fence delimiters).
 */
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

/**
 * Applies inline markdown styling (code spans, links, bold, italic) to a single line's text.
 */
export function renderInlineMarkdown(text: string): string {
  return (
    text
      // Inline code first so its contents are not re-styled.
      .replace(/`([^`]+)`/g, (_match, code) => chalk.cyan(code))
      // Links: [label](url) -> underlined label with a dimmed url.
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        (_match, label, url) => `${chalk.underline(label)} ${chalk.dim(`(${url})`)}`
      )
      // Bold: **text** or __text__.
      .replace(/(\*\*|__)(.+?)\1/g, (_match, _marker, content) => chalk.bold(content))
      // Italic: *text* (not part of **) ...
      .replace(/(?<!\*)\*(?!\s)([^*\n]+?)\*(?!\*)/g, (_match, content) => chalk.italic(content))
      // ... and _text_ (only when the underscores are not inside a word, e.g. a_b_c).
      .replace(/(?<![A-Za-z0-9_])_(?!\s)([^_\n]+?)_(?![A-Za-z0-9_])/g, (_match, content) =>
        chalk.italic(content)
      )
  );
}
