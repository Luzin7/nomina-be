# Melhorias e riscos identificados — nomina-be

Levantado durante o alinhamento dos testes ao pivô de `categoryId` obrigatório e
`closingDay` → `closingDaysBeforeDue` (branch `fix/category-required-and-invoice-cycle-rules`).
Os itens de migration foram corrigidos e testados na própria branch; o restante
ficou de fora do escopo de propósito, para não misturar com o que já estava em
andamento.

---

## ✅ Migrations com conversão de dado (resolvido)

As migrations `0012` e `0013` alteravam colunas sem migrar o dado existente. Ambas
foram corrigidas nesta branch e testadas contra um Postgres 16 real, em quatro
cenários: banco legado do zero, banco onde o seed já havia criado as categorias
com UUID aleatório, reaplicação das duas migrations, e o estado intermediário em
que a `0012` antiga já tinha rodado.

- **`0013`** agora cria as categorias de sistema que usa, reponta duplicatas para
  os IDs canônicos e preenche `category_id` das linhas órfãs — tudo antes do
  `SET NOT NULL`, que falharia em qualquer banco com histórico
- **`0012`** converte `closing_day` → `closing_days_before_due` antes do `DROP
  COLUMN`, e ajusta `due_day` acima de 28. É idempotente, porque foi editada
  depois de já ter sido aplicada em desenvolvimento

⚠️ **Ressalva para o ambiente local:** na máquina onde a `0012` antiga já rodou, o
`closing_day` foi derrubado antes da conversão existir — esse dado não é
recuperável e os cartões existentes ficaram com o padrão de 7 dias. Em staging e
produção, onde a `0012` nunca rodou, a conversão funciona normalmente.

---

## 🟡 Qualidade e arquitetura

### 3. As `test-helpers/mock-factories.ts` prometidas não existem

`.github/copilot-instructions.md` e `.github/instructions/create-tests.instructions.md`
descrevem um `test-helpers/mock-factories.ts` por módulo com
`createMock<Name>Repository()` e builders de entidade. **Nenhum existe.**

A consequência é concreta: a factory de `Transaction` está copiada em ~10 specs,
e o mock de `CategoryRepository` em 4. Foi exatamente por isso que tornar um
campo obrigatório quebrou 5 suítes de uma vez e exigiu editar 8 arquivos de
teste — e por que adicionar um método ao contrato do repositório obrigou a
atualizar 4 mocks à mão.

Criar os arquivos que a documentação já promete é a maior redução de atrito
disponível hoje na base.

### 4. Erros genéricos em `Transaction.create` ✅

A entidade ainda devolve `new Error('The amount must be greater than zero')` e
similares — inclusive com um `// Substituir por DomainError` no código. Sem
herdar de `DomainError`, o `ErrorPresenter` não sabe mapear e vira 500 opaco em
vez da mensagem de validação. `CreditCardAccount` já foi migrado; `Transaction`
ficou para trás. (O caso do `categoryId` foi migrado nesta branch.)

**Resolvido na `fix/improvements-cheap-to-medium`:** todos os `new Error()` foram
substituídos por subclasses de `DomainError` (`InvalidAmountError`,
`TitleRequiredError`, `StatusRequiredError`, `DateRequiredError`,
`TypeRequiredError`, `TransactionAlreadyCompletedError`,
`TransactionAlreadyPendingError`).

### 5. `Transaction.create` ignora o `status` recebido ✅

O status é sempre derivado da data (`props.date > new Date()`), mesmo quando o
chamador passa um explicitamente. Hoje funciona por coincidência — os specs
inclusive comentam isso — mas é uma armadilha: o job passa
`status: PENDING` e só não quebra porque as datas geradas são futuras. Ou o
parâmetro deixa de existir na assinatura, ou ele passa a ser respeitado.

**Resolvido na `fix/improvements-cheap-to-medium`:** `props.status` agora é
respeitado quando fornecido; quando omitido, deriva da data como antes.

### 6. `MAX_GENERATIONS_PER_RECURRING = 365` não conversa com o domínio

Numa recorrência mensal, 365 gerações são 30 anos de transações num único batch.
O cap deveria ser função da frequência, ou a janela deveria limitar por data em
vez de contagem.

### 7. `resolvePaymentDate` mistura dois timezones

Em `PayCreditCardInvoiceService`, "hoje" vem de `sourceAccount.timezone` e o
ciclo da fatura de `creditCardAccount.timezone`. Se as contas tiverem timezones
diferentes, a comparação `periodEnd < today` fica ambígua na virada do dia.

### 8. `availableLimit` pode ficar negativo sem tratamento ✅

`GetCreditCardInvoiceService` calcula
`creditLimit - totalAmount - pendingAmount` sem piso. Com transações pendentes
somando mais que o limite, a API devolve um número negativo e o app exibe do
jeito que veio.

**Resolvido na `fix/improvements-cheap-to-medium`:** `Math.max(0, ...)` aplicado
no cálculo; teste adicionado.

### 9. `AccountMapper.toDrizzle` depende do default do banco ✅

Para contas que não são cartão, o mapper devolve
`closingDaysBeforeDue: undefined`, contando com o `DEFAULT 7` da coluna. Funciona,
mas amarra o mapper ao DDL: se o default mudar ou sumir, o insert quebra longe
daqui. Melhor ser explícito.

**Resolvido na `fix/improvements-cheap-to-medium`:** trocado `undefined` por `7`
explícito no mapper.

### 10. Suíte de testes leva ~3,5 minutos

54 suítes em ~212 s em execução padrão. A maior parte é startup de transpilação
por arquivo. Vale medir `--maxWorkers` e avaliar `swc` no lugar do `ts-jest`, se
ainda for esse o transform.

---

## 🟢 Follow-ups menores

### 11. `README.md` referencia `docker-compose.yml` ✅

O arquivo foi renomeado para `docker-compose.dev.yml` nesta branch; o README
ainda manda subir o antigo.

**Resolvido na `fix/improvements-cheap-to-medium`:** README atualizado para
`docker compose -f docker-compose.dev.yml up -d`.

### 12. Secrets do repositório não configurados

`Luzin7/nomina-be` não tem **nenhum** secret nem environment configurado
(`gh api repos/Luzin7/nomina-be/actions/secrets` → `total_count: 0`), mas os
workflows dependem de dois:

| Secret | Usado por | Efeito da ausência |
|---|---|---|
| `DATABASE_URL` | `run-migrations.yml` | Migrations não rodam no deploy |
| `CRON_API_KEY` | `daily-job.yml` | Job diário de recorrências não dispara |

Provavelmente ficaram para trás na migração do repositório antigo
(`Umatech-team/nomina-be`). Só o dono do repositório pode configurá-los, em
**Settings → Secrets and variables → Actions**.

### 13. Lint com 24 erros pré-existentes ✅

Seis controllers de recorrência têm imports não usados (`UserRole`, `UseGuards`,
`Roles`, `RolesGuard`) — resquício de quando a autorização era feita por
decorator no controller. `npm run lint` falha por causa deles, o que significa
que ninguém está rodando o lint. Vale limpar e ligar o lint no CI.

**Resolvido na `fix/improvements-cheap-to-medium`:** imports não usados removidos
dos 6 controllers; `npm run lint` passa limpo.

### 14. O ciclo de fatura é rotulado por mês de referência, não de vencimento

`GetCreditCardInvoiceService` recebe `month`/`year` e trata como o mês de
*referência* do ciclo. O app, depois desta rodada, passou a rotular a fatura pelo
mês de *vencimento*. Nos casos em que o vencimento cai no mês seguinte ao do
período de compras, o usuário vê "Fatura de agosto" mas o pagamento é enviado
com `month: 7`. Não é um bug hoje — os dois lados são consistentes entre si —
mas é uma divergência de vocabulário esperando para virar um.
