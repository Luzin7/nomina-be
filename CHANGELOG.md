# Changelog — Nomina API

Todas as mudanças notáveis da API são documentadas aqui.
Segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/) e [Semantic Versioning](https://semver.org/lang/pt-BR/).

---

## [Unreleased]

### Alterado (breaking)

- `categoryId` passa a ser obrigatório em `Transaction` e `RecurringTransaction` — entidade, DTOs, schema Drizzle e migration `0013`. Transferências e pagamento de fatura são a exceção: o backend resolve sozinho uma categoria de sistema (ver Adicionado)
- `closingDay` (dia fixo do mês) substituído por `closingDaysBeforeDue` (dias antes do vencimento) em `CreditCard`, DTOs, `DateProvider.calculateInvoiceCycle`, schema e migration `0012`. O valor é um conjunto fechado: **5, 7 ou 10**, validado igual na entidade e nos dois DTOs. `dueDay` limitado a 1–28 em todas as camadas
- Pivô de cartão de crédito: abandonada a ideia de reproduzir parcelamento com cálculo próprio na entidade de cartão. Compra parcelada agora é uma recorrência comum com `totalAmount`/modo de valor total, que gera as parcelas mês a mês e se autodesativa ao passar do `endDate` (`RecurringTransaction`, `GenerateRecurringTransactionsJobService`)
- `BaseAccount`: lógica de crédito/débito de saldo unificada e reaproveitada por `CashAccounts`, `CheckingAccount`, `InvestmentAccount` e `CreditCardAccount` (antes duplicada em cada entidade)

### Adicionado

- Categorias de sistema com ID fixo (`SYSTEM_CATEGORY`) para transferências (`Transferência`) e pagamento de fatura (`Cartão de Crédito`). O backend as atribui sozinho, usando a constante direto — sem consultar o banco. Substitui o UUID que estava hardcoded no DTO de pagamento de fatura e que só existia no banco onde o seed o tinha gerado; agora o mesmo ID é contrato, garantido pela migration `0013` e pelo seed
- `PayCreditCardInvoiceService` aceita `month`/`year`, ancorando o pagamento no fim do ciclo quando a fatura alvo já fechou — sem isso, quitar em agosto a fatura de julho lançava o pagamento no ciclo de agosto e a fatura de julho nunca refletia nada
- Suporte a modo de valor total (`totalAmount`) em transações recorrentes, permitindo cadastrar uma compra parcelada informando o total e o número de parcelas
- Autodesativação de recorrências ao atingir `endDate`
- Erros de domínio tipados: `MissingCategoryError`, `InvalidClosingDaysBeforeDueError`, `InvalidDueDayError`
- Migrations `0012` e `0013` passam a migrar o dado existente, não só o schema: a `0013` cria as categorias de sistema, reponta duplicatas e preenche `category_id` das linhas órfãs antes do `SET NOT NULL`; a `0012` converte `closing_day` em `closing_days_before_due` antes do `DROP COLUMN` e ajusta `due_day` acima de 28. Ambas são idempotentes e foram testadas contra Postgres 16 em quatro cenários

### Corrigido

- `GenerateRecurringTransactionsJobService`: uma recorrência com dado inválido travava o job diário inteiro num laço infinito. O caminho de erro recalculava a data sem marcar a recorrência como gerada, então `calculateNextGenerationDate` devolvia sempre a mesma data, e o `generationCount` não incrementado impedia o guard de segurança de disparar. Agora a recorrência inválida é logada uma vez e abandonada, e as demais do batch seguem
- `GenerateRecurringTransactionsJobService`: a paginação chamava `listNeedingGeneration` sempre com offset 0, repetindo a mesma consulta enquanto viessem páginas cheias
- `UpdateAccountService`: o retorno de `validateCreditCardFields()` era descartado — limite de crédito ou datas de fatura inválidos eram silenciosamente ignorados e a API respondia 200 como se tivesse salvo
- `CreditCard.create`: `closingDaysBeforeDue ?? null` num campo tipado como `number` deixava um `undefined` escapar da validação e virar `NaN` no cálculo do ciclo
- `GetCreditCardInvoiceService.totalAmount` não descontava pagamentos parciais já feitos no ciclo atual, podendo mostrar um valor de fatura maior do que o saldo real aceito por `payInvoice()` (issue #41). Também trocados `new Error(...)` genéricos por erros de domínio tipados em `CreditCardAccount`, `CashAccounts`, `CheckingAccount`, `InvestmentAccount` e `BaseAccount`, que antes viravam 500 opaco em vez da mensagem de validação real
- Pipeline de CI/CD e semantic-release agora também roda na branch `develop`, usada como staging antes do deploy automático em `main` (Render aponta pra `main`)

### Testes

- Specs alinhados ao pivô: as factories de `Transaction`/`RecurringTransaction` estavam duplicadas em cada arquivo e nenhuma passava `categoryId`, o que derrubou 5 suítes (17 testes) e deixou 38 erros de `tsc` — todos em `.spec.ts`
- Corrigidos specs que validavam a coisa errada: `update-account.dto.spec.ts` redefinia uma cópia local do schema Zod em vez de importar o real; `CreditCardAccount.spec.ts` tinha um caso cujo nome não descrevia o que ele testava; `create-account.service.spec.ts` afirmava um comportamento que o pivô havia invertido
- Restaurados o happy path de TRANSFER em `create-transaction.service.spec.ts` e o `describe('updateInvoiceDates()')` em `CreditCardAccount.spec.ts`, apagados durante o pivô
- `RecurringTransaction.create()` ganhou a validação de `categoryId` em runtime, que existia só no tipo

### Documentação

- `docs/MELHORIAS.md`: riscos e melhorias levantados durante essa rodada e deixados fora do escopo — com destaque para as migrations `0012`/`0013`, que alteram colunas sem migrar o dado existente

---

## [0.11.0] — 2026-05-03

### Adicionado

- Schema inicial de banco de dados para contas, categorias e transações via migration

### Corrigido

- `CreditCardInvoicePresenter`: `pendingAmount` agora incluso na resposta HTTP
- `GetCreditCardInvoiceService`: cálculo de `pendingAmount` e lógica de `availableLimit` corrigidos
- `CreditCardAccount`: `creditLimit` e `closingDaysBeforeDue` agora aceitam `null`
- `CreateAccountService`: validação de `creditLimit` null corrigida
- `UpdateAccountService`: `closingDaysBeforeDue` opcional e nullable em `updateAccountSchema`
- `AccountPresenter`: valores null de `creditLimit` e `availableLimit` tratados corretamente
- `account.mapper`: melhoria no tratamento de null em propriedades de cartão
- Rota de toggle de status renomeada de `PATCH /transaction/recurring/:id/status` para `PATCH /transaction/:id/status`

---

## [0.10.0] — 2026-05-01

### Adicionado

- Cobertura abrangente de testes unitários em todos os módulos:
  - Entidades: `User`, `RefreshToken`, `Transaction`, `RecurringTransaction`, `Subscription`, `Category`, `Workspace`, `WorkspaceInvite`, `WorkspaceUser`
  - Services: `CreateTransaction`, `DeleteTransaction`, `FindTransactionById`, `ListTransactions`, `ToggleTransactionStatus`, `PayCreditCardInvoice`, `CreateUser`, `GetProfile`, `LoginUser`, `RefreshToken`, `CreateWorkspace`, `DeleteWorkspace`, `FindWorkspaceById`, `ListWorkspaces`, `AddUserToWorkspace`, `RemoveUserFromWorkspace`, `SwitchWorkspace`, `UpdateWorkspace`, `ListCategories`, `ListAccounts`, `FindAccountById`, `GetCreditCardInvoice`, `UpdateAccount`
  - DTOs: `CreateUserRequest`, `LoginUserRequest`, `CreateTransactionRequest`, `CreateWorkspaceRequest`

---

## [0.9.0] — 2026-04-26

### Adicionado

- `FindMonthSummaryService`: resumo mensal com cálculo de variação percentual em relação ao mês anterior
- Coluna `time_zone` em `workspaces` e `workspace_users` para suporte a fuso horário por usuário
- `DateProvider` como classe abstrata com métodos adicionais de manipulação de datas

### Alterado

- `GenerateRecurringTransactionsJobService`: timezone agora passado para `calculateNextDateService`
- `WorkspaceRepository`: `findManyByUserId` renomeado para `findOwnedByUserId`
- Entidades: método `reconstitute` renomeado para `restore` para maior clareza semântica
- `TransactionMapper`: usa `restore` no lugar do construtor direto
- Handlers renomeados para Services em todos os módulos para consistência de nomenclatura

---

## [0.8.0] — 2026-04-25

### Adicionado

- Entidades de domínio distintas: `CheckingAccount`, `CreditCardAccount`, `InvestmentAccount`
- Tipo `AnyAccount` para unificar os três tipos de conta na API
- `UpdateWorkspaceUserService`: atualização de roles com verificação de autorização

### Alterado

- `AccountRepository` e `AccountPresenter` atualizados para usar `AnyAccount`
- `CreateAccountService`, `UpdateAccountService`, `ListAccountsService` reescritos como services (substituindo handlers)

---

## [0.7.0] — 2026-04-22

### Corrigido

- `tsconfig.json`: paths de módulos atualizados para resolução correta
- `DeleteWorkspaceHandler`: extração de parâmetros corrigida no controller

---

## [0.6.0] — 2026-04-08

### Adicionado

- `availableLimit` exposto no presenter de `CreditCardInvoice`
- Auto-derivação de status da transação a partir da data no `CreateTransactionService` e na entidade `Transaction`

### Corrigido

- Reports de cash flow e balance evolution excluem transações de cartão de crédito
- Reversão de saldo corrigida com base no tipo de transação (entrada/saída)
- Cálculo de próxima data para transações recorrentes ajustado

---

## [0.5.0] — 2026-03-31

### Adicionado

- Campo `title` em transações e transações recorrentes (criação, atualização, listagem, presenter)
- Preview de transação inclui `title` no presenter
- Testes para job de geração de recorrências e handlers de transações recorrentes

---

## [0.4.0] — 2026-03-11

### Adicionado

- Cobertura de testes para controllers e handlers de `Workspace`, `WorkspaceInvite`, `RecurringTransaction`
- Testes para `CreateRecurringTransactionController` e `DeleteRecurringTransactionController`

### Corrigido

- `FindRecurringTransactionController`: usa route parameters em vez de request body
- Validação de datas: `isNaN` substituído por `Number.isNaN` nos schemas de criação e atualização
- `RecurringTransactionPresenter`: campo `type` ausente adicionado na resposta

---

## [0.3.0] — 2026-03-05

### Adicionado

- `GetExpensesByCategoryHandler`: lógica de categorização de despesas com testes
- Cálculo de percentual arredondado para dois decimais nos reports

### Corrigido

- Handlers de workspace (`RemoveUserFromWorkspace`, `ListWorkspaces`, `CreateWorkspace`): ajustes de tipagem e formatação

---

## [0.2.0] — 2026-02-21

### Alterado

- Projeto renomeado de **Lastro** para **Nomina** (configs, título da API, variáveis de ambiente)
- Workflow de CI/CD ajustado para branch `main`

---

## [0.1.0] — 2026-02-01

### Adicionado

- CRUD completo de **Contas** (`CheckingAccount`, cartão de crédito): criação, listagem, busca, atualização, exclusão
- CRUD completo de **Categorias**: criação, listagem, busca, atualização, exclusão
- Categorias padrão de despesa e receita provisionadas automaticamente por workspace
- Índices no banco de dados em `transactions.account_id` para melhoria de performance
- Repositórios de `Account` e `Category` integrados ao `DatabaseModule`
- Workspace: CRUD completo com gerenciamento de usuários (convite, remoção, troca, atualização de role)

### Corrigido

- `TransactionMapper`: mapeamento de `recurringId` corrigido

---

## [0.0.1] — 2026-01-26

### Adicionado

- Estrutura inicial do projeto (NestJS + Drizzle ORM + PostgreSQL + Redis)
- Módulos base: `User`, `Workspace`, `Auth` (JWT com refresh token)
- Autenticação com `accessToken` e `refreshToken`; payload: `{ sub, workspaceId, role }`
- CRUD de **Transações** e **Transações Recorrentes** com job de geração automática (cron)
- **Reports**: evolução de saldo, evolução de fluxo de caixa, despesas por categoria
- Multi-tenancy: todo recurso filtrado por `workspaceId` extraído do token JWT
- Swagger disponível em `/api` no ambiente `dev`
- Contratos da API: dinheiro em centavos inteiros (`bigint`), datas no formato `YYYY-MM-DD`
