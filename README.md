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

- Node.js 22
- Docker & Docker Compose

### Setup

```bash
# 1. Dependências
npm install

# 2. Variáveis de ambiente (preencher JWT_PRIVATE_KEY e JWT_PUBLIC_KEY)
cp .env.example .env

# 3. Infraestrutura: PostgreSQL 17 (porta 5433) e Redis 7 (porta 6380)
docker compose -f docker-compose.dev.yml up -d

# 4. Migrations
npm run db:migrate

# 5. Servidor em watch mode
npm run dev
```

As portas do host fogem das padrão para não colidir com outros projetos.
Para trocar, defina `POSTGRES_HOST_PORT` / `REDIS_HOST_PORT` no `.env` e
ajuste `DATABASE_URL` / `REDIS_PORT` junto. Se `REDIS_URL` estiver definido,
ele tem prioridade sobre `REDIS_HOST` / `REDIS_PORT`.

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

Produção roda no Render a partir da imagem publicada no GitHub Container
Registry (`ghcr.io/luzin7/nomina-be`, pública). O Render não builda nada: só
puxa a imagem.

A cada push na `main`, o `release.yml`:

1. roda testes, `tsc` e build;
2. aplica as migrations pendentes no banco de produção;
3. gera a versão com semantic-release e publica a imagem com as tags
   `vX.Y.Z`, `sha-<commit>` e `latest`;
4. chama o deploy hook do Render com o digest da imagem publicada.

Commit que não gera versão (sem `feat`/`fix`) roda as migrations, mas não
publica imagem nem faz deploy. Como as migrations entram antes da imagem nova,
elas precisam funcionar com o código da versão anterior (adicionar antes,
remover depois).

### Serviço no Render

- Source: imagem `ghcr.io/luzin7/nomina-be` (pública, sem credencial). O
  workflow sempre manda o digest; a tag configurada no painel só vale para
  "Manual Deploy", então um deploy manual volta para ela
- Health check path: `/api/v1/health` (o Render injeta `PORT=10000`)
- Variáveis: as do schema em `src/infra/env/index.ts`, com `NODE_ENV=production`

### Secrets do GitHub Actions

Configurar em **Settings → Secrets and variables → Actions**:

| Secret | Workflow | Uso |
|--------|----------|-----|
| `DATABASE_URL` | `release.yml` | Migrations antes do deploy. `drizzle-kit` recusa host não local por padrão; `ALLOW_PROD_MIGRATE=1` libera de propósito e runners de CI (`CI=true`) são liberados automaticamente |
| `RENDER_DEPLOY_HOOK_URL` | `release.yml` | Deploy da imagem no Render |
| `CRON_API_KEY` | `daily-job.yml` | Job diário de recorrências |

---

## Licença

UNLICENSED — Software proprietário.
