import dotenv from 'dotenv';

import { formatEnvValue } from '../dotenv';

function roundTrip(value: string): string | undefined {
  return dotenv.parse(`KEY=${formatEnvValue(value)}`).KEY;
}

describe(formatEnvValue, () => {
  it('leaves values dotenv already reads back unchanged unquoted', () => {
    expect(formatEnvValue('')).toBe('');
    expect(formatEnvValue('https://api.example.com')).toBe('https://api.example.com');
    expect(formatEnvValue('postgres://localhost:5432/mydb')).toBe('postgres://localhost:5432/mydb');
    expect(formatEnvValue('a$&b$1c')).toBe('a$&b$1c');
    expect(formatEnvValue('{"a":1}')).toBe('{"a":1}');
    expect(formatEnvValue("it's")).toBe("it's");
    expect(formatEnvValue('literal\\nsequence')).toBe('literal\\nsequence');
  });

  it('quotes values dotenv would otherwise truncate, trim or drop', () => {
    expect(formatEnvValue('#ffffff')).toBe('"#ffffff"');
    expect(formatEnvValue('  padded ')).toBe('"  padded "');
    expect(formatEnvValue('line\nbreak')).toBe('"line\\nbreak"');
    expect(formatEnvValue("'single'")).toBe('"\'single\'"');
  });

  it('avoids double quotes for values that carry their own quotes or escapes', () => {
    expect(formatEnvValue('{"color":"#f00"}')).toBe('\'{"color":"#f00"}\'');
    expect(formatEnvValue('literal\\nsequence with a # in it')).toBe(
      "'literal\\nsequence with a # in it'"
    );
    expect(formatEnvValue('mixed "double" and \'single\' #quotes')).toBe(
      '`mixed "double" and \'single\' #quotes`'
    );
  });

  it.each([
    ['a plain value', 'https://api.example.com'],
    ['a hex color', '#ffffff'],
    ['a url with a fragment', 'https://example.com/docs#install'],
    ['a value with an inline comment marker', 'secret#123'],
    ['surrounding whitespace', '  padded '],
    ['a single space', ' '],
    ['an empty value', ''],
    ['an apostrophe', "it's"],
    ['a fully quoted value', '"quoted"'],
    ['a single quoted value', "'quoted'"],
    ['a backtick quoted value', '`quoted`'],
    ['a newline', 'multi\nline'],
    ['a carriage return', 'multi\r\nline'],
    ['json', '{"a":1,"b":"two"}'],
    ['json with a comment marker', '{"color":"#f00"}'],
    ['a literal backslash-n sequence', 'literal\\nsequence'],
    ['a backslash', 'C:\\Users\\expo'],
    ['every quote character', 'mixed "double" and \'single\' and `backtick`'],
    ['an rsa private key', '-----BEGIN KEY-----\nabc\ndef\n-----END KEY-----'],
  ])('round-trips %s through dotenv', (_name, value) => {
    expect(roundTrip(value)).toBe(value);
  });

  it('cannot be used to define another variable through a value', () => {
    const parsed = dotenv.parse(`KEY=${formatEnvValue('value\nINJECTED=hijacked')}\nOTHER=kept\n`);
    expect(parsed.KEY).toBe('value\nINJECTED=hijacked');
    expect(parsed.INJECTED).toBeUndefined();
    expect(parsed.OTHER).toBe('kept');
  });
});
