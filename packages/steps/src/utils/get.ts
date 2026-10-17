// Minimal replacement for lodash.get, covering the path shapes this package
// produces: dot-separated keys (`steps.step1.outputs.out`), bracketed array
// indices (`list[0].name`), and bracketed keys with or without quotes
// (`a[b]`, `a["b.c"]`, `a['b']`) as emitted by jsepEval's getParameterPath.

const QUOTE_CHARACTERS = ["'", '"'];

export function parsePath(path: string): string[] {
  const keys: string[] = [];
  let index = 0;
  while (index < path.length) {
    const character = path[index];
    if (character === '.') {
      index += 1;
    } else if (character === '[') {
      const maybeQuote = path[index + 1];
      if (QUOTE_CHARACTERS.includes(maybeQuote)) {
        const closingQuoteIndex = path.indexOf(`${maybeQuote}]`, index + 2);
        if (closingQuoteIndex === -1) {
          throw new Error(`Invalid path: unterminated quoted bracket in "${path}"`);
        }
        keys.push(path.slice(index + 2, closingQuoteIndex));
        index = closingQuoteIndex + 2;
      } else {
        const closingBracketIndex = path.indexOf(']', index + 1);
        if (closingBracketIndex === -1) {
          throw new Error(`Invalid path: unterminated bracket in "${path}"`);
        }
        keys.push(path.slice(index + 1, closingBracketIndex));
        index = closingBracketIndex + 1;
      }
    } else {
      let end = index;
      while (end < path.length && path[end] !== '.' && path[end] !== '[') {
        end += 1;
      }
      keys.push(path.slice(index, end));
      index = end;
    }
  }
  return keys;
}

export function get(object: unknown, path: string): any {
  // Like lodash.get, a path that exists verbatim as an own property wins
  // over interpreting it as a nested path.
  if (object != null && typeof object === 'object' && Object.hasOwn(object, path)) {
    return (object as Record<string, unknown>)[path];
  }
  let current: any = object;
  for (const key of parsePath(path)) {
    if (current == null) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

export default get;
