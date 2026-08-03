import {
  SupabaseConnectionData,
  SupabaseOrganizationData,
  SupabaseProjectData,
} from '../../graphql/types/SupabaseConnection';
import Log from '../../log';
import {
  formatSupabaseOrganization,
  formatSupabaseProject,
  formatSupabaseProjectLabel,
  getSupabaseProjectDashboardUrl,
  logNoSupabaseProject,
  parseSupabaseProjectRef,
} from '../supabase';

jest.mock('../../log', () => ({
  __esModule: true,
  default: {
    warn: jest.fn(),
    log: jest.fn(),
  },
  link: jest.fn((url: string) => url),
}));

describe('commandUtils/supabase', () => {
  const project: SupabaseProjectData = {
    id: 'project-1',
    supabaseProjectRef: 'abcdefghijklmnop',
    supabaseProjectName: 'Demo App',
    supabaseProjectUrl: 'https://abcdefghijklmnop.supabase.co',
    supabaseRegion: 'us-east-1',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };

  it('getSupabaseProjectDashboardUrl encodes the project ref', () => {
    expect(getSupabaseProjectDashboardUrl({ supabaseProjectRef: 'abc/def' })).toBe(
      'https://supabase.com/dashboard/project/abc%2Fdef'
    );
  });

  it('formatSupabaseOrganization prefers a distinct name', () => {
    const connection: Pick<
      SupabaseConnectionData,
      'supabaseOrganizationSlug' | 'supabaseOrganizationName'
    > = {
      supabaseOrganizationSlug: 'org-slug',
      supabaseOrganizationName: 'Org Name',
    };
    expect(formatSupabaseOrganization(connection)).toBe('Org Name (org-slug)');
  });

  it('formatSupabaseOrganization falls back to live org name', () => {
    const connection = {
      supabaseOrganizationSlug: 'org-slug',
      supabaseOrganizationName: null as unknown as string,
    };
    const organizations: SupabaseOrganizationData[] = [
      { id: '1', slug: 'org-slug', name: 'Live Name' },
    ];
    expect(formatSupabaseOrganization(connection, organizations)).toBe('Live Name (org-slug)');
  });

  it('formatSupabaseOrganization returns slug when name matches or is missing', () => {
    expect(
      formatSupabaseOrganization({
        supabaseOrganizationSlug: 'same',
        supabaseOrganizationName: 'same',
      })
    ).toBe('same');
    expect(
      formatSupabaseOrganization({
        supabaseOrganizationSlug: 'only-slug',
        supabaseOrganizationName: '',
      })
    ).toBe('only-slug');
  });

  it('formatSupabaseProjectLabel prefers a distinct name', () => {
    expect(formatSupabaseProjectLabel(project)).toBe('Demo App (abcdefghijklmnop)');
  });

  it('formatSupabaseProjectLabel returns ref when name matches or is missing', () => {
    expect(
      formatSupabaseProjectLabel({
        supabaseProjectRef: 'ref',
        supabaseProjectName: 'ref',
      })
    ).toBe('ref');
    expect(
      formatSupabaseProjectLabel({
        supabaseProjectRef: 'ref',
        supabaseProjectName: '',
      })
    ).toBe('ref');
  });

  it('formatSupabaseProject includes key fields', () => {
    const formatted = formatSupabaseProject(project);
    expect(formatted).toContain('Demo App');
    expect(formatted).toContain('abcdefghijklmnop');
    expect(formatted).toContain('https://abcdefghijklmnop.supabase.co');
    expect(formatted).toContain('us-east-1');
    expect(formatted).toContain('https://supabase.com/dashboard/project/abcdefghijklmnop');
  });

  it('logNoSupabaseProject warns with the project name', () => {
    logNoSupabaseProject('my-app');
    expect(Log.warn).toHaveBeenCalledWith(expect.stringContaining('my-app'));
  });
});

describe(parseSupabaseProjectRef, () => {
  it('accepts a bare reference ID', () => {
    expect(parseSupabaseProjectRef('jfurmbuioogljwsqwnpd')).toBe('jfurmbuioogljwsqwnpd');
    expect(parseSupabaseProjectRef('  jfurmbuioogljwsqwnpd  ')).toBe('jfurmbuioogljwsqwnpd');
  });

  it('accepts a dashboard URL', () => {
    expect(
      parseSupabaseProjectRef('https://supabase.com/dashboard/project/kwdfdxdzurxigtbtwddj')
    ).toBe('kwdfdxdzurxigtbtwddj');
    expect(
      parseSupabaseProjectRef(
        'https://supabase.com/dashboard/project/kwdfdxdzurxigtbtwddj/settings/general'
      )
    ).toBe('kwdfdxdzurxigtbtwddj');
  });

  it('accepts a project API URL', () => {
    expect(parseSupabaseProjectRef('https://kwdfdxdzurxigtbtwddj.supabase.co')).toBe(
      'kwdfdxdzurxigtbtwddj'
    );
  });

  it('rejects a project name with guidance', () => {
    expect(() => parseSupabaseProjectRef('@testuser/test-app-personal-661c52f1')).toThrow(
      /not a Supabase project reference ID/
    );
    expect(() => parseSupabaseProjectRef('@testuser/test-app-personal-661c52f1')).toThrow(
      /Project Settings/
    );
  });

  it('rejects an unrelated URL and an empty value', () => {
    expect(() => parseSupabaseProjectRef('https://example.com/foo')).toThrow(
      /not a Supabase project reference ID/
    );
    expect(() => parseSupabaseProjectRef('   ')).toThrow(/No Supabase project given/);
  });

  it('treats a malformed URL as a non-ref and rejects it', () => {
    expect(() => parseSupabaseProjectRef('https://[')).toThrow(
      /not a Supabase project reference ID/
    );
  });
});
