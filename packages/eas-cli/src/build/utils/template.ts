import template from 'lodash/template';

export function evaluateString(s: string, vars: Record<string, any>): string {
  return template(s, { interpolate: /\$\(([\s\S]+?)\)/g })(vars);
}
