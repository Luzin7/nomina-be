# Melhorias e riscos identificados — nomina-be

Levantado durante o alinhamento dos testes ao pivô de `categoryId` obrigatório e
`closingDay` → `closingDaysBeforeDue` (branch `fix/category-required-and-invoice-cycle-rules`).
Nada aqui foi corrigido nessa branch — ficou de fora do escopo de propósito, para
não misturar com o que já estava em andamento.

---

## 🔴 Bloqueadores de deploy

### 1. Migration `0013` põe `category_id` como NOT NULL sem backfill

```sql
ALTER TABLE "recurring_transactions" ALTER COLUMN "category_id" SET NOT NULL;
ALTER TABLE "transactions" ALTER COLUMN "category_id" SET NOT NULL;
```

Até este pivô `category_id` era nullable, então qualquer banco com histórico tem
linhas com `NULL`. O `ALTER` falha em cima delas e a migration aborta —
provavelmente já em staging.

Antes do `ALTER`, a migration precisa de um backfill apontando para uma categoria
de sistema, algo como:

```sql
UPDATE transactions t
SET category_id = (
  SELECT id FROM categories
  WHERE workspace_id IS NULL AND is_system_category = true
    AND name = 'Outros Gastos' AND type = 'EXPENSE'
  LIMIT 1
)
WHERE t.category_id IS NULL;
```

O mesmo para `recurring_transactions`, e cuidando de transferências, que devem
apontar para a categoria `Transferência` introduzida nesta branch. Isso torna a
ordem obrigatória: **seed de categorias antes da migration**.

### 2. Migration `0012` derruba `closing_day` sem converter o dado

```sql
ALTER TABLE "accounts" ADD COLUMN "closing_days_before_due" integer DEFAULT 7 NOT NULL;
...
ALTER TABLE "accounts" DROP COLUMN "closing_day";
```

Todo cartão de crédito já cadastrado perde silenciosamente o dia de fechamento e
passa a valer 7. Para quem tinha fechamento distante do vencimento, o ciclo da
fatura muda sem aviso — e o valor exibido muda junto.

Uma conversão aproximada antes do `DROP` preservaria a intenção:

```sql
UPDATE accounts
SET closing_days_before_due = LEAST(GREATEST(((due_day - closing_day + 30) % 30), 5), 10)
WHERE type = 'CREDIT_CARD' AND closing_day IS NOT NULL AND due_day IS NOT NULL;
```

Como o novo domínio é o conjunto fechado {5, 7, 10}, o resultado precisa ser
encaixado na opção mais próxima. Vale conferir quantas contas existem hoje — se
forem poucas, um script pontual é mais honesto que a fórmula.

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

### 4. Erros genéricos em `Transaction.create`

A entidade ainda devolve `new Error('The amount must be greater than zero')` e
similares — inclusive com um `// Substituir por DomainError` no código. Sem
herdar de `DomainError`, o `ErrorPresenter` não sabe mapear e vira 500 opaco em
vez da mensagem de validação. `CreditCardAccount` já foi migrado; `Transaction`
ficou para trás. (O caso do `categoryId` foi migrado nesta branch.)

### 5. `Transaction.create` ignora o `status` recebido

O status é sempre derivado da data (`props.date > new Date()`), mesmo quando o
chamador passa um explicitamente. Hoje funciona por coincidência — os specs
inclusive comentam isso — mas é uma armadilha: o job passa
`status: PENDING` e só não quebra porque as datas geradas são futuras. Ou o
parâmetro deixa de existir na assinatura, ou ele passa a ser respeitado.

### 6. `MAX_GENERATIONS_PER_RECURRING = 365` não conversa com o domínio

Numa recorrência mensal, 365 gerações são 30 anos de transações num único batch.
O cap deveria ser função da frequência, ou a janela deveria limitar por data em
vez de contagem.

### 7. `resolvePaymentDate` mistura dois timezones

Em `PayCreditCardInvoiceService`, "hoje" vem de `sourceAccount.timezone` e o
ciclo da fatura de `creditCardAccount.timezone`. Se as contas tiverem timezones
diferentes, a comparação `periodEnd < today` fica ambígua na virada do dia.

### 8. `availableLimit` pode ficar negativo sem tratamento

`GetCreditCardInvoiceService` calcula
`creditLimit - totalAmount - pendingAmount` sem piso. Com transações pendentes
somando mais que o limite, a API devolve um número negativo e o app exibe do
jeito que veio.

### 9. `AccountMapper.toDrizzle` depende do default do banco

Para contas que não são cartão, o mapper devolve
`closingDaysBeforeDue: undefined`, contando com o `DEFAULT 7` da coluna. Funciona,
mas amarra o mapper ao DDL: se o default mudar ou sumir, o insert quebra longe
daqui. Melhor ser explícito.

### 10. Suíte de testes leva ~3,5 minutos

54 suítes em ~212 s em execução padrão. A maior parte é startup de transpilação
por arquivo. Vale medir `--maxWorkers` e avaliar `swc` no lugar do `ts-jest`, se
ainda for esse o transform.

---

## 🟢 Follow-ups menores

### 11. `README.md` referencia `docker-compose.yml`

O arquivo foi renomeado para `docker-compose.dev.yml` nesta branch; o README
ainda manda subir o antigo.

### 12. Lint com 24 erros pré-existentes

Seis controllers de recorrência têm imports não usados (`UserRole`, `UseGuards`,
`Roles`, `RolesGuard`) — resquício de quando a autorização era feita por
decorator no controller. `npm run lint` falha por causa deles, o que significa
que ninguém está rodando o lint. Vale limpar e ligar o lint no CI.

### 13. O ciclo de fatura é rotulado por mês de referência, não de vencimento

`GetCreditCardInvoiceService` recebe `month`/`year` e trata como o mês de
*referência* do ciclo. O app, depois desta rodada, passou a rotular a fatura pelo
mês de *vencimento*. Nos casos em que o vencimento cai no mês seguinte ao do
período de compras, o usuário vê "Fatura de agosto" mas o pagamento é enviado
com `month: 7`. Não é um bug hoje — os dois lados são consistentes entre si —
mas é uma divergência de vocabulário esperando para virar um.
