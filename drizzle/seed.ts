import { config } from 'dotenv';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/infra/databases/drizzle/schema';
import { categories } from '../src/infra/databases/drizzle/schema';
import { env } from '../src/infra/env';
import {
  SEED_CHILD_CATEGORIES,
  SEED_PARENT_CATEGORIES,
  type SeedCategoryRef,
} from '../src/modules/category/constants/seed-categories';
import { SYSTEM_CATEGORY } from '../src/modules/category/constants/system-categories';

config();

const shouldUseSSL =
  env.NODE_ENV === 'production' || env.DATABASE_URL.includes('sslmode=require');

const client = postgres(env.DATABASE_URL, {
  ssl: shouldUseSSL ? { rejectUnauthorized: false } : false,
});
const db = drizzle(client, { schema });

async function main(): Promise<void> {
  await db.transaction(async (tx) => {
    const existingIds = new Set(
      (
        await tx
          .select({ id: categories.id })
          .from(categories)
          .where(eq(categories.isSystemCategory, true))
      ).map((row) => row.id),
    );

    const parentsToInsert: Array<{
      id: string;
      name: string;
      type: string;
      workspaceId: null;
      isSystemCategory: boolean;
    }> = [];

    const childrenToInsert: Array<{
      id: string;
      name: string;
      type: string;
      workspaceId: null;
      isSystemCategory: boolean;
      parentId: string;
    }> = [];

    for (const cat of SEED_PARENT_CATEGORIES) {
      if (existingIds.has(cat.id)) continue;

      parentsToInsert.push({
        id: cat.id,
        name: cat.name,
        type: cat.type,
        workspaceId: null,
        isSystemCategory: true,
      });
    }

    if (parentsToInsert.length > 0) {
      await tx.insert(categories).values(parentsToInsert);
    }

    for (const cat of SEED_CHILD_CATEGORIES) {
      if (existingIds.has(cat.id)) continue;

      childrenToInsert.push({
        id: cat.id,
        name: cat.name,
        type: cat.type,
        workspaceId: null,
        isSystemCategory: true,
        parentId: cat.parentId,
      });
    }

    if (childrenToInsert.length > 0) {
      await tx.insert(categories).values(childrenToInsert);
    }

    // Garantir que system categories (TRANSFER, CREDIT_CARD) existam com IDs corretos
    const systemCategoryEntries = Object.values(SYSTEM_CATEGORY);

    for (const sysCat of systemCategoryEntries) {
      if (!existingIds.has(sysCat.id)) {
        await tx
          .insert(categories)
          .values({
            id: sysCat.id,
            name: sysCat.name,
            type: sysCat.type,
            workspaceId: null,
            isSystemCategory: true,
          })
          .onConflictDoNothing({ target: categories.id });
      }
    }
  });
}

function runSeed(): void {
  main()
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await client.end();
    });
}

runSeed();