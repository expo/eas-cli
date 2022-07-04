import { sanitizeLanguage } from '../language.js';

describe(sanitizeLanguage, () => {
  it('throws when language not found', () => {
    expect(() => sanitizeLanguage('Ponglish')).toThrowError();
  });

  it('throws when default language is invalid', () => {
    expect(() => sanitizeLanguage(undefined, { defaultLang: 'Ponglish' })).toThrowError();
  });

  it('returns default if no lang is provided', () => {
    expect(sanitizeLanguage(undefined, { defaultLang: 'en-US' })).toBe('en-US');
  });

  it('returns language iTunes code', () => {
    expect(sanitizeLanguage('English')).toBe('en-US');
    expect(sanitizeLanguage('pl-PL')).toBe('pl');
  });
});
