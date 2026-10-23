# Changelog — Nomina API

Todas as mudanças notáveis da API são documentadas aqui.
Segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/) e [Semantic Versioning](https://semver.org/lang/pt-BR/).

## [2.0.0](https://github.com/Luzin7/nomina-be/compare/v1.5.1...v2.0.0) (2026-10-23)

### ⚠ BREAKING CHANGES

* **transaction:** nomina-fe sends startDate on this route (nomina-fe#71) and
must confirm the payload carries no extra keys, expect lastGenerated to be
null after a start-date edit, and handle 422 for a credit-card destination.
* **transaction:** nomina-fe must send the desired status and treat 409 as
"nothing changed"; adapting that client is a separate task in its repo.

### Features

* **account:** liquida parcela agendada sem reconferir limite ([a7c69bc](https://github.com/Luzin7/nomina-be/commit/a7c69bc23238db48afa244210041b338df7c62f0))
* **account:** record every balance change as a movement ([558b04e](https://github.com/Luzin7/nomina-be/commit/558b04eb47150d5f506e064ed44d051ea7d6fbd7)), closes [#30](https://github.com/Luzin7/nomina-be/issues/30)
* **auth:** sessões de autenticação e rotação de refresh token ([d204a86](https://github.com/Luzin7/nomina-be/commit/d204a863a2aa518d2055dba77d00bb5b78dea089))
* **category:** unifica categorias legadas repetidas ([cfbe3ae](https://github.com/Luzin7/nomina-be/commit/cfbe3ae3ca824a7e947f1562d4fa8d3c6dee5875))
* **db:** block drizzle-kit on non-local hosts ([b3a5a69](https://github.com/Luzin7/nomina-be/commit/b3a5a691b288ce53f3430f2f61aec3fbf937db8e))
* **reconciliation:** report balance drift from the ledger ([550347e](https://github.com/Luzin7/nomina-be/commit/550347e41f6660cce13287f5d07a51669ce7159c)), closes [#30](https://github.com/Luzin7/nomina-be/issues/30) [#41](https://github.com/Luzin7/nomina-be/issues/41)
* **recurring:** backfill de parcelas e pré-checks ([d3f46cb](https://github.com/Luzin7/nomina-be/commit/d3f46cb0085574aba99a85e920833fd609c45217))
* **recurring:** persiste número de parcelas ([1549956](https://github.com/Luzin7/nomina-be/commit/1549956c30291684807401422cf82b22a2108fbd))
* **report:** resumo do mês compara com o mesmo período do mês anterior ([e46007d](https://github.com/Luzin7/nomina-be/commit/e46007db3b288c5f476567bf130c6202e677fdd0))
* **transaction:** endpoint de compra parcelada ([08c9dc8](https://github.com/Luzin7/nomina-be/commit/08c9dc8ff9c414e5f41cc352f4d3bc39482a39ba))
* **transaction:** job diário conclui parcelas vencidas do cartão ([b2c87e5](https://github.com/Luzin7/nomina-be/commit/b2c87e565f92560350178f26e48b154574e163ce))
* **transaction:** lista retorna conta de origem e destino ([383519a](https://github.com/Luzin7/nomina-be/commit/383519af02147f22b472bff3d691739b7a2088ac))
* **transaction:** set the desired status instead of toggling ([b79a54a](https://github.com/Luzin7/nomina-be/commit/b79a54a5ce93d4839d4556febfe819d9b4e57d9d))

### Bug Fixes

* **account:** gera id antes do insert da conta ([e8a73be](https://github.com/Luzin7/nomina-be/commit/e8a73be3320a0cdba8126a8ac68bc614983975bb))
* **account:** preserve balance on account edit ([498798d](https://github.com/Luzin7/nomina-be/commit/498798db162babe9cf6370a4572a87e95767fed9)), closes [#40](https://github.com/Luzin7/nomina-be/issues/40)
* **account:** require the movement actor and alert on backfill failures ([3149358](https://github.com/Luzin7/nomina-be/commit/3149358f032673f0a772219b4a1090cc93992e77))
* **account:** write balance as a relative delta ([436d3ae](https://github.com/Luzin7/nomina-be/commit/436d3ae735377f87d001495830cb7cfdef778a6a))
* **auth:** mapeia erros de autorização para 401 e 403 ([6474804](https://github.com/Luzin7/nomina-be/commit/6474804aaae463e4b1ae0cd1515b11bee8b9a720))
* **auth:** reuso de refresh token dentro de 60s ([a423d38](https://github.com/Luzin7/nomina-be/commit/a423d38dc005c1e504b30191e0dee6620b4a3177))
* **cache:** fail closed when the Redis lock is unavailable and bound redis command timeouts ([fa74fd8](https://github.com/Luzin7/nomina-be/commit/fa74fd8678b8798cec7f2acb41b724fce4330bf3)), closes [#28](https://github.com/Luzin7/nomina-be/issues/28)
* **cache:** only release locks owned by the caller ([5588809](https://github.com/Luzin7/nomina-be/commit/558880946ac6b3b9f2aa570a460d48c516d7c958)), closes [#52](https://github.com/Luzin7/nomina-be/issues/52)
* **categories:** drop real production index names in 0018 migration ([dee5ed8](https://github.com/Luzin7/nomina-be/commit/dee5ed86910f1ef085c802b0bc026a249ea1ccbc))
* **categories:** remap all legacy global categories in 0018 migration ([e6764bf](https://github.com/Luzin7/nomina-be/commit/e6764bfc0ef916fac7a366c74c7b5f3316d58c26))
* **categories:** seed default categories as per-workspace UUIDs ([ccd79b8](https://github.com/Luzin7/nomina-be/commit/ccd79b80c4253be994e13b2977966d5d6ca7f48f))
* **database:** fixa TimeZone=UTC na sessão do drizzle ([fb65adc](https://github.com/Luzin7/nomina-be/commit/fb65adc877eb5534317f2255c591f7d687448047))
* **db:** allow null category on recurring rows ([2d20eaf](https://github.com/Luzin7/nomina-be/commit/2d20eaf0803aac39e7b9e945e10e1a9091786109))
* **db:** corrige baseline do drizzle e preserva 0016/0017 ([a8ff530](https://github.com/Luzin7/nomina-be/commit/a8ff53091957bc4dcc6112a686fb0d6fdcdfc909))
* **db:** renumber generated drizzle migrations ([eabcb15](https://github.com/Luzin7/nomina-be/commit/eabcb15d414bb93fc3afcfb5ee6468b98913116e)), closes [#53](https://github.com/Luzin7/nomina-be/issues/53)
* **db:** unique index on transactions (recurring_transaction_id, date) ([3b2f852](https://github.com/Luzin7/nomina-be/commit/3b2f852f668c414b00ed0962aadb112b7f10cf94))
* **http:** answer 503 on postgres lock and statement timeouts ([cac9f18](https://github.com/Luzin7/nomina-be/commit/cac9f18551cedaef41794476227651e6eba78cc8)), closes [#30](https://github.com/Luzin7/nomina-be/issues/30)
* **http:** limite de requisições por usuário em vez de IP compartilhado ([c88dec8](https://github.com/Luzin7/nomina-be/commit/c88dec8a8283ad93aa7496ff8a5facdbdf4433f6))
* **jobs:** disambiguate recurring job outcomes ([3cdf1ac](https://github.com/Luzin7/nomina-be/commit/3cdf1ac3948a744cf5d822db4d7832a208f6c9e5)), closes [#54](https://github.com/Luzin7/nomina-be/issues/54)
* **ledger:** abre saldo na conta Carteira padrão ([a7c2555](https://github.com/Luzin7/nomina-be/commit/a7c2555883747e324110ec9a42dbd171e889e8df))
* **ledger:** conciliação usa só movimentações ([b7869dc](https://github.com/Luzin7/nomina-be/commit/b7869dc54154ddfdd4d03ab5ba0e7326006e0b76))
* **migrations:** make 0016 and 0017 safe to re-run ([4eceb1f](https://github.com/Luzin7/nomina-be/commit/4eceb1f20a72e7f82d18682eeaaa781a45926be7))
* pula rate limit no job de liquidação de parcelas de cartão ([8576701](https://github.com/Luzin7/nomina-be/commit/8576701353fd345b215a23780cbb73f75abcc39d))
* **transaction:** apply account and start edits ([d3dca27](https://github.com/Luzin7/nomina-be/commit/d3dca27387c1d7e87210089daf9db35a612dc121)), closes [#43](https://github.com/Luzin7/nomina-be/issues/43) [#43](https://github.com/Luzin7/nomina-be/issues/43)
* **transaction:** enforce idempotency on transaction and invoice payment routes ([cb400b0](https://github.com/Luzin7/nomina-be/commit/cb400b0c1b2c5fcc194dfe02f17e56afc70ea3a2)), closes [#27](https://github.com/Luzin7/nomina-be/issues/27)
* **transaction:** filtro por conta inclui transferências recebidas ([3fcaa48](https://github.com/Luzin7/nomina-be/commit/3fcaa48d56482800faf71850228032ab7668456c))
* **transactions:** keyset na geração de recorrências e falha visível do job ([346ee3d](https://github.com/Luzin7/nomina-be/commit/346ee3d038a77c51015b7e6d919c859a269bb099))
* **transactions:** skip already-generated rows and report the real count ([c283046](https://github.com/Luzin7/nomina-be/commit/c2830466933c02df58bd70eeac585fddb634ce8f))
* **workspace:** aceite de convite normaliza código e mostra o motivo ([0ffe340](https://github.com/Luzin7/nomina-be/commit/0ffe340cd5520670a9457f782fedea062d6ae6f3))

## [1.5.1](https://github.com/Luzin7/nomina-be/compare/v1.5.0...v1.5.1) (2026-10-10)

### Bug Fixes

* **env:** lê REDIS_ENABLED como flag e fecha o job interno sem CRON_API_KEY ([8845abb](https://github.com/Luzin7/nomina-be/commit/8845abb67123c92ca4c6399bf3ba585357cae8c5))

## [1.5.0](https://github.com/Luzin7/nomina-be/compare/v1.4.0...v1.5.0) (2026-10-10)

### Features

* **invoice:** monta o extrato da fatura com saldo anterior ([bbf3fce](https://github.com/Luzin7/nomina-be/commit/bbf3fcea4da7378fbf602e8a96203c02ccf1d699))

### Bug Fixes

* **invoice:** calcula a fatura do cartão pelo extrato, não pelo carimbo do pagamento ([6943326](https://github.com/Luzin7/nomina-be/commit/69433268c2263cfc03b525a914f218eb77297499))

## [1.4.0](https://github.com/Luzin7/nomina-be/compare/v1.3.1...v1.4.0) (2026-10-02)

### Features

* **auth:** refresh token em cookie httpOnly com rotação atômica ([58ce58e](https://github.com/Luzin7/nomina-be/commit/58ce58ed665d06bf73e1899381c9a150e071c595))

### Bug Fixes

* **invoice:** corrige pagamento de fatura e transferência para cartão ([979d143](https://github.com/Luzin7/nomina-be/commit/979d143e17ccb104030ef1dea0f96389ed58f4cf))

## [1.3.1](https://github.com/Luzin7/nomina-be/compare/v1.3.0...v1.3.1) (2026-10-01)

### Bug Fixes

* **invoice:** corrige ciclo da fatura e separa cobranças de pagamentos ([a4e0093](https://github.com/Luzin7/nomina-be/commit/a4e0093e1d13ea6efc1193fc21147dd40bdf3ddd))
* **release:** corrige notas vazias, tag maiúscula no GHCR e integra release ao push em main ([3baef1f](https://github.com/Luzin7/nomina-be/commit/3baef1f63d32b30671852357f13c4ae1238eb02d))
* **release:** regenera package-lock com npm 10 para bater com o npm ci do CI ([f2a03fb](https://github.com/Luzin7/nomina-be/commit/f2a03fbaef01391c7c0916afa8a164c4d8df299d))
* **report:** ancora saldo de contas correntes na evolucao patrimonial ([38e43be](https://github.com/Luzin7/nomina-be/commit/38e43beb0fad413a9cf35495d4d5eed13d52b0d1))

## [1.3.0](https://github.com/Luzin7/nomina-be/compare/v1.2.1...v1.3.0) (2026-10-01)

## [1.2.1](https://github.com/Luzin7/nomina-be/compare/v1.2.0...v1.2.1) (2026-09-18)

## [1.2.0](https://github.com/Luzin7/nomina-be/compare/v1.1.0...v1.2.0) (2026-09-14)

## [1.1.0](https://github.com/Luzin7/nomina-be/compare/v1.0.1...v1.1.0) (2026-09-13)

## [1.0.1](https://github.com/Luzin7/nomina-be/compare/v1.0.0...v1.0.1) (2026-08-27)

## 1.0.0 (2026-08-06)

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
