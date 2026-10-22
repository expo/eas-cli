/** `lodash.escapeRegExp` */
const REGEXP_SPECIAL_CHARACTERS = /[\\^$.*+?()[\]{}|]/g;

export default function escapeRegExp(value: string): string {
  return value.replace(REGEXP_SPECIAL_CHARACTERS, '\\$&');
}
