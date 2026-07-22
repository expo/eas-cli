import chalk from 'chalk';

import {
  createMarkdownRenderState,
  renderInlineMarkdown,
  renderMarkdownLine,
  wrapToWidth,
} from '../renderMarkdown';

describe(renderInlineMarkdown, () => {
  it('renders bold with chalk.bold', () => {
    expect(renderInlineMarkdown('a **bold** word')).toBe(`a ${chalk.bold('bold')} word`);
    expect(renderInlineMarkdown('a __bold__ word')).toBe(`a ${chalk.bold('bold')} word`);
  });

  it('renders inline code with chalk.cyan', () => {
    expect(renderInlineMarkdown('run `eas build` now')).toBe(`run ${chalk.cyan('eas build')} now`);
  });

  it('leaves underscores inside a word untouched', () => {
    expect(renderInlineMarkdown('my_project_name')).toBe('my_project_name');
  });

  it('renders links as underlined label with dimmed url', () => {
    expect(renderInlineMarkdown('see [build](https://expo.dev/b/1)')).toBe(
      `see ${chalk.underline('build')} ${chalk.dim('(https://expo.dev/b/1)')}`
    );
  });
});

describe(renderMarkdownLine, () => {
  it('renders bullet lines with a bullet glyph', () => {
    const state = createMarkdownRenderState();
    expect(renderMarkdownLine('- first', state)).toBe(`${chalk.dim('•')} first`);
  });

  it('drops code fences and dims code block contents', () => {
    const state = createMarkdownRenderState();
    expect(renderMarkdownLine('```ts', state)).toBeNull();
    expect(state.inCodeBlock).toBe(true);
    expect(renderMarkdownLine('const x = 1;', state)).toBe(chalk.gray('const x = 1;'));
    expect(renderMarkdownLine('```', state)).toBeNull();
    expect(state.inCodeBlock).toBe(false);
  });

  it('applies inline styling to plain lines', () => {
    const state = createMarkdownRenderState();
    expect(renderMarkdownLine('the **latest** build', state)).toBe(
      `the ${chalk.bold('latest')} build`
    );
  });
});

describe(wrapToWidth, () => {
  it('word-wraps to the given width', () => {
    const segments = wrapToWidth('one two three four five', 12);
    expect(segments.length).toBeGreaterThan(1);
    for (const segment of segments) {
      expect(segment.length).toBeLessThanOrEqual(12);
    }
    expect(segments.join(' ').replace(/\s+/g, ' ').trim()).toBe('one two three four five');
  });

  it('hard-breaks long unbreakable tokens like URLs', () => {
    const url = 'https://expo.dev/accounts/acme/projects/mobile/builds/cb7c9bdd-56e6-42b8';
    const segments = wrapToWidth(url, 20);
    expect(segments.length).toBeGreaterThan(1);
    for (const segment of segments) {
      expect(segment.length).toBeLessThanOrEqual(20);
    }
    expect(segments.join('')).toBe(url);
  });

  it('returns the text unchanged when the width is too small to wrap into', () => {
    expect(wrapToWidth('anything at all here', 4)).toEqual(['anything at all here']);
  });
});
