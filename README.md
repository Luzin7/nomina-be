# Nomina — API

> **O peso real do seu patrimônio.**

API de gestão patrimonial pessoal. NestJS + PostgreSQL + Redis, arquitetura DDD com Clean Architecture.

**Versão atual:** `0.11.0` — ver [CHANGELOG](./CHANGELOG.md)

---

## Stack

| Camada | Tecnologia |
|---|---|
| Framework | NestJS |
| Banco de dados | PostgreSQL + Drizzle ORM |
| Cache | Redis (opcional) |
| Autenticação | JWT RS256 (access + refresh token) |
| Validação | Zod |
| Testes | Jest |
| Documentação | Swagger (disponível em `dev`) |

---

## Rodando localmente

### Pré-requisitos

- Node.js 18+
- Docker & Docker Compose

### Setup

```bash
# 1. Dependências
npm install

# 2. Variáveis de ambiente
cp .env.example .env
```

`.env` mínimo:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/nomina"
JWT_PRIVATE_KEY_BASE64="<chave-privada-base64>"
JWT_PUBLIC_KEY_BASE64="<chave-publica-base64>"
NODE_ENV="dev"
PORT=8080
REDIS_ENABLED=false
```

```bash
# 3. Infraestrutura (PostgreSQL + Redis)
docker compose -f docker-compose.dev.yml up -d

# 4. Migrations
npm run db:migrate

# 5. Servidor em watch mode
npm run dev
```

API disponível em `http://localhost:8080`
Swagger em `http://localhost:8080/api/docs` (apenas `NODE_ENV=dev`)

---

## Scripts

```bash
npm run dev           # Desenvolvimento (watch mode)
npm run build         # Build para produção
npm run start:prod    # Iniciar produção
npm test              # Testes unitários
npm run test:cov      # Coverage
npm run lint          # ESLint

npm run db:migrate    # Aplicar migrations pendentes
npm run db:generate   # Gerar nova migration a partir do schema
npm run db:status     # Ver status das migrations
npm run db:rollback   # Reverter última migration
npm run seed          # Popular banco com dados iniciais
```

---

## Banco de dados (Migrations)

> **Regra:** sempre execute `npm run db:migrate` antes de subir o servidor em produção.

Para criar uma nova migration após alterar o schema em `src/infra/databases/schema/`:

```bash
npm run db:generate -- --name descricao-da-mudanca
# revise o SQL gerado em drizzle/
npm run db:migrate
```

Nunca edite arquivos `.sql` gerados manualmente — sempre via `db:generate`.

---

## Arquitetura

### Estrutura de módulo

Cada feature segue o padrão:

```
src/modules/<module>/
├── features/
│   └── <feature-name>/
│       ├── <feature>.controller.ts   # Endpoint HTTP
│       ├── <feature>.service.ts      # Lógica de negócio
│       └── <feature>.dto.ts          # Validação Zod
├── entities/                         # Modelos de domínio
├── repositories/                     # Contratos de acesso a dados
│   └── <repo>.repository.ts
├── presenters/                       # Formatação da resposta HTTP
└── errors/                           # Erros de domínio tipados
```

### Módulos

| Módulo | Responsabilidade |
|---|---|
| `user` | Criação de conta, login, refresh token, perfil |
| `workspace` | Multi-tenancy — criação, convites, roles, switch |
| `account` | Contas correntes, cartões de crédito, investimentos |
| `category` | Categorias de receita/despesa por workspace |
| `transaction` | Transações avulsas e recorrentes, fatura de cartão |
| `report` | Resumo mensal, evolução de saldo, fluxo de caixa, despesas por categoria |
| `subscription` | Planos e limites de recursos por workspace |

### Padrão Either para erros

Todos os services retornam `Either<DomainError, Result>`. Nenhum service lança exceção:

```typescript
const result = await service.execute(request);
if (result.isLeft()) {
  return ErrorPresenter.toHTTP(result.value); // erro tipado → HTTP status correto
}
return { data: result.value };
```

### Contratos críticos

**Dinheiro em centavos inteiros** — sem floats em nenhuma camada:

```
DB: bigint  →  JSON: number  →  ex: 10050 = R$ 100,50
```

**Datas no formato `YYYY-MM-DD`** — sem timezone em campos de data.

**Multi-tenancy via JWT** — `workspaceId` sempre vem do token, nunca do body ou de URL params.

---

## Autenticação

- Access token: 15 minutos (RS256)
- Refresh token: 7 dias (RS256)

### Roles

| Role | Permissões |
|---|---|
| `OWNER` | Acesso total ao workspace |
| `ADMIN` | Criar e editar recursos |
| `USER` | Criar transações, visualizar |
| `VIEWER` | Somente leitura |

### Rate limiting

Endpoints públicos de auth têm limite de **10 requisições por minuto** por IP (login, register, refresh).
Demais endpoints autenticados: **120 requisições por minuto**.

---

## Deploy

```bash
npm run build
npm run db:migrate   # sempre antes de iniciar
npm run start:prod
```

### Variáveis de ambiente (produção)

```env
DATABASE_URL="postgresql://user:pass@host:5432/nomina"
JWT_PRIVATE_KEY_BASE64="..."
JWT_PUBLIC_KEY_BASE64="..."
NODE_ENV="production"
PORT=8080
REDIS_ENABLED=true
REDIS_HOST="..."
REDIS_PORT=6379
PROD_URL="https://seu-dominio.com"
DEV_URL="http://localhost:3000"
CRON_API_KEY="chave-para-job-diario"
```

### Secrets do GitHub Actions

Os workflows dependem de dois secrets que **precisam** ser configurados em
**Settings → Secrets and variables → Actions**:

| Secret | Workflow | Uso |
|--------|----------|-----|
| `DATABASE_URL` | `run-migrations.yml` | Migrations no deploy |
| `CRON_API_KEY` | `daily-job.yml` | Job diário de recorrências |

---

## Licença

UNLICENSED — Software proprietário.
