import path from 'path';

import { createContext } from 'this-file';

const ctx = createContext();

export const BIN_PATH = path.join(ctx.dirname, '../../../bin');
