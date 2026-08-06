import { config } from 'dotenv';
import { and, eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../src/infra/databases/drizzle/schema';
import { categories } from '../src/infra/databases/drizzle/schema';
import { env } from '../src/infra/env';
import { SYSTEM_CATEGORY } from '../src/modules/category/constants/system-categories';

const SYSTEM_CATEGORY_IDS = {
  TRANSFER: SYSTEM_CATEGORY.TRANSFER.id,
  CREDIT_CARD_PAYMENT: SYSTEM_CATEGORY.CREDIT_CARD_PAYMENT.id,
};

config();

const shouldUseSSL =
  env.NODE_ENV === 'production' || env.DATABASE_URL.includes('sslmode=require');

const client = postgres(env.DATABASE_URL, {
  ssl: shouldUseSSL ? { rejectUnauthorized: false } : false,
});
const db = drizzle(client, { schema });

type TransactionType = 'INCOME' | 'EXPENSE' | 'TRANSFER';

interface CategorySeed {
  name: string;
  type: TransactionType;
  children?: string[];
  /**
   * ID fixo, para as categorias que o backend referencia direto no código —
   * ver `src/modules/category/constants/system-categories.ts`. Quando ausente,
   * o ID é gerado pelo banco.
   */
  id?: string;
}

interface CategoryInsert {
  name: string;
  type: TransactionType;
  workspaceId: null;
  isSystemCategory: boolean;
  id?: string;
}

interface ChildCategoryInsert extends CategoryInsert {
  parentId: string;
}

const categoriesData: CategorySeed[] = [
  { name: 'Salário', type: 'INCOME' },
  { name: 'Freelance', type: 'INCOME' },
  {
    name: 'Investimentos',
    type: 'INCOME',
    children: ['Dividendos', 'Juros', 'Rendimento CDB'],
  },
  { name: 'Vendas', type: 'INCOME' },
  { name: 'Prêmios', type: 'INCOME' },
  { name: 'Reembolsos', type: 'INCOME' },
  { name: 'Outros Ganhos', type: 'INCOME' },
  {
    name: 'Alimentação',
    type: 'EXPENSE',
    children: ['Restaurantes', 'Mercado', 'Lanche', 'Delivery'],
  },
  {
    name: 'Transporte',
    type: 'EXPENSE',
    children: [
      'Combustível',
      'Uber/99',
      'Transporte Público',
      'Estacionamento',
      'Manutenção',
    ],
  },
  {
    name: 'Moradia',
    type: 'EXPENSE',
    children: [
      'Aluguel',
      'Condomínio',
      'IPTU',
      'Água',
      'Energia',
      'Gás',
      'Internet',
      'Manutenção',
    ],
  },
  {
    name: 'Saúde',
    type: 'EXPENSE',
    children: [
      'Plano de Saúde',
      'Consultas',
      'Medicamentos',
      'Exames',
      'Academia',
    ],
  },
  {
    name: 'Educação',
    type: 'EXPENSE',
    children: ['Mensalidade', 'Cursos', 'Materiais', 'Livros'],
  },
  {
    name: 'Lazer',
    type: 'EXPENSE',
    children: ['Cinema', 'Streaming', 'Viagens', 'Hobbies', 'Eventos'],
  },
  {
    name: 'Vestuário',
    type: 'EXPENSE',
    children: ['Roupas', 'Calçados', 'Acessórios'],
  },
  {
    name: 'Beleza',
    type: 'EXPENSE',
    children: ['Cabeleireiro', 'Cosméticos', 'Tratamentos'],
  },
  {
    name: 'Pets',
    type: 'EXPENSE',
    children: ['Veterinário', 'Ração', 'Petshop'],
  },
  {
    name: 'Impostos',
    type: 'EXPENSE',
    children: ['IRPF', 'IPVA'],
  },
  {
    name: 'Serviços',
    type: 'EXPENSE',
    children: ['Contador', 'Advogado', 'Seguros', 'Assinaturas'],
  },
  { name: 'Presentes', type: 'EXPENSE' },
  { name: 'Doações', type: 'EXPENSE' },
  { name: 'Telefonia', type: 'EXPENSE' },
  // IDs fixos: o backend atribui essas duas sozinho, em pagamento de fatura e
  // transferência, e as referencia pela constante em vez de consultar o banco.
  // A migration 0013 garante as mesmas linhas com os mesmos IDs.
  { name: 'Cartão de Crédito', type: 'EXPENSE', id: SYSTEM_CATEGORY_IDS.CREDIT_CARD_PAYMENT },
  { name: 'Outros Gastos', type: 'EXPENSE' },
  { name: 'Transferência', type: 'TRANSFER', id: SYSTEM_CATEGORY_IDS.TRANSFER },
];

async function main(): Promise<void> {
  await db.transaction(async (tx) => {
    const existingSystemCategories = await tx
      .select({
        id: categories.id,
        name: categories.name,
        type: categories.type,
        parentId: categories.parentId,
      })
      .from(categories)
      .where(
        and(
          isNull(categories.workspaceId),
          eq(categories.isSystemCategory, true),
        ),
      );

    const parentIdByNameAndType = new Map<string, string>();
    const existingChildren = new Set<string>();

    for (const row of existingSystemCategories) {
      if (row.parentId === null) {
        parentIdByNameAndType.set(`${row.name}::${row.type}`, row.id);
        continue;
      }

      existingChildren.add(`${row.parentId}::${row.name}::${row.type}`);
    }

    const childrenToInsert: ChildCategoryInsert[] = [];

    for (const parentData of categoriesData) {
      const parentKey = `${parentData.name}::${parentData.type}`;
      let parentId = parentIdByNameAndType.get(parentKey);

      if (!parentId) {
        const [insertedParent] = await tx
          .insert(categories)
          .values({
            ...(parentData.id ? { id: parentData.id } : {}),
            name: parentData.name,
            type: parentData.type,
            workspaceId: null,
            isSystemCategory: true,
          })
          .returning({ id: categories.id });

        parentId = insertedParent.id;
        parentIdByNameAndType.set(parentKey, parentId);
      }

      if (parentData.children?.length) {
        for (const childName of parentData.children) {
          const childKey = `${parentId}::${childName}::${parentData.type}`;
          if (existingChildren.has(childKey)) {
            continue;
          }

          childrenToInsert.push({
            name: childName,
            type: parentData.type,
            parentId,
            workspaceId: null,
            isSystemCategory: true,
          });

          existingChildren.add(childKey);
        }
      }
    }

    if (childrenToInsert.length > 0) {
      await tx.insert(categories).values(childrenToInsert);
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
