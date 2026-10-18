import * as dotenv from 'dotenv';
import { defineConfig } from 'drizzle-kit';
import {
  allowRemoteMigrationTarget,
  assertSafeMigrationTarget,
} from './src/infra/databases/drizzle/assert-safe-migration-target';

dotenv.config({ path: '.env' });

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL não está definida nas variáveis de ambiente');
}

assertSafeMigrationTarget({
  databaseUrl: process.env.DATABASE_URL,
  allowProd: allowRemoteMigrationTarget(process.env),
});

export default defineConfig({
  schema: './src/infra/databases/drizzle/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  verbose: true,
  strict: true,
});
