import { DefaultEnvironment } from '../../../build/utils/environment';

import { EAS_SUPABASE_ENVIRONMENTS } from '../environments';

describe('EAS_SUPABASE_ENVIRONMENTS', () => {
  it('lists production, preview, and development in that order', () => {
    expect(EAS_SUPABASE_ENVIRONMENTS).toEqual([
      DefaultEnvironment.Production,
      DefaultEnvironment.Preview,
      DefaultEnvironment.Development,
    ]);
  });
});
