import { infoRestrictedWords } from '../infoRestrictedWords';

describe('infoRestrictedWords', () => {
  it('returns null when apple.info is missing or empty', () => {
    expect(infoRestrictedWords.validate({} as any)).toBeNull();
    expect(infoRestrictedWords.validate({ apple: { info: {} } } as any)).toBeNull();
  });

  it('allows text without restricted words', () => {
    const config = {
      apple: {
        info: {
          'en-US': {
            title: 'My Wonderful App',
            subtitle: 'Productivity made simple',
            description: 'The best app to organize your daily life.',
            keywords: 'productivity, notes, organize',
          },
        },
      },
    };

    expect(infoRestrictedWords.validate(config as any)).toEqual([]);
  });

  it('does not flag words that contain "beta" as a substring (e.g. Danish "Betal", "Alphabet")', () => {
    const config = {
      apple: {
        info: {
          da: {
            title: 'Betal med appen',
            subtitle: 'Hurtig og sikker betaling',
            description: 'Betal nemt og hurtigt for dine varer i butikken.',
            keywords: 'betal, butik, nemt',
          },
          de: {
            title: 'Alphabet Trainer',
            subtitle: 'Lerne das Alphabet',
            description: 'Buchstaben von A bis Z lernen.',
            keywords: 'alphabet, lernen, kinder',
          },
          nl: {
            title: 'Veilig betalen',
            subtitle: 'Eenvoudig online betalen',
            description: 'Snel en veilig betalen met iDEAL.',
            keywords: ['veilig', 'betalen', 'bank'],
          },
          'en-US': {
            title: 'Diabetes Health Tracker',
            subtitle: 'Track blood sugar and meals',
            description: 'Manage diabetes with daily logs and insights.',
            keywords: ['diabetes', 'health', 'tracker'],
          },
        },
      },
    };

    expect(infoRestrictedWords.validate(config as any)).toEqual([]);
  });

  it('flags restricted word "beta" in title, subtitle, description, and keywords', () => {
    const config = {
      apple: {
        info: {
          'en-US': {
            title: 'CoolApp Beta',
            subtitle: 'Now in beta test',
            description: 'Welcome to the public beta release.',
            keywords: ['utility', 'tools', 'beta'],
          },
        },
      },
    };

    const issues = infoRestrictedWords.validate(config as any) as any[];
    expect(issues).toHaveLength(4);

    expect(issues[0]).toEqual({
      id: 'apple.info.restrictedWords',
      severity: 1,
      path: ['apple', 'info', 'en-US', 'title'],
      message: 'Apple restricts the word "beta" and synonyms implying incomplete functionality.',
    });
    expect(issues[1]).toEqual({
      id: 'apple.info.restrictedWords',
      severity: 1,
      path: ['apple', 'info', 'en-US', 'subtitle'],
      message: 'Apple restricts the word "beta" and synonyms implying incomplete functionality.',
    });
    expect(issues[2]).toEqual({
      id: 'apple.info.restrictedWords',
      severity: 1,
      path: ['apple', 'info', 'en-US', 'description'],
      message: 'Apple restricts the word "beta" and synonyms implying incomplete functionality.',
    });
    expect(issues[3]).toEqual({
      id: 'apple.info.restrictedWords',
      severity: 1,
      path: ['apple', 'info', 'en-US', 'keywords'],
      message: 'Apple restricts the word "beta" and synonyms implying incomplete functionality.',
    });
  });

  it('flags case-insensitive and punctuation-delimited instances of "beta"', () => {
    const config = {
      apple: {
        info: {
          'en-US': {
            title: 'App (BETA)',
            subtitle: 'Version 2.0-beta',
            description: 'beta: explore new experimental features!',
            keywords: 'v2, beta, test',
          },
        },
      },
    };

    const issues = infoRestrictedWords.validate(config as any) as any[];
    expect(issues).toHaveLength(4);
  });
});
