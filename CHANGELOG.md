# Changelog — Nomina API

Todas as mudanças notáveis da API são documentadas aqui.
Segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/) e [Semantic Versioning](https://semver.org/lang/pt-BR/).

---

## [Unreleased]

### Alterado

- Pivô de cartão de crédito: abandonada a ideia de reproduzir parcelamento com cálculo próprio na entidade de cartão. Compra parcelada agora é uma recorrência comum com `totalAmount`/modo de valor total, que gera as parcelas mês a mês e se autodesativa ao passar do `endDate` (`RecurringTransaction`, `GenerateRecurringTransactionsJobService`)
- `BaseAccount`: lógica de crédito/débito de saldo unificada e reaproveitada por `CashAccounts`, `CheckingAccount`, `InvestmentAccount` e `CreditCardAccount` (antes duplicada em cada entidade)

### Adicionado

- Suporte a modo de valor total (`totalAmount`) em transações recorrentes, permitindo cadastrar uma compra parcelada informando o total e o número de parcelas
- Autodesativação de recorrências ao atingir `endDate`

### Corrigido

- Pipeline de CI/CD e semantic-release agora também roda na branch `develop`, usada como staging antes do deploy automático em `main` (Render aponta pra `main`)

### Em andamento (PR aberta, aguardando merge)

- Fix da issue #41 (erro genérico ao pagar fatura): `GetCreditCardInvoiceService.totalAmount` não descontava pagamentos parciais já feitos no ciclo atual, podendo mostrar um valor de fatura maior do que o saldo real aceito por `payInvoice()`. Também trocados `new Error(...)` genéricos por erros de domínio tipados em `CreditCardAccount`, `CashAccounts`, `CheckingAccount`, `InvestmentAccount` e `BaseAccount`, que antes viravam 500 opaco em vez da mensagem de validação real

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
