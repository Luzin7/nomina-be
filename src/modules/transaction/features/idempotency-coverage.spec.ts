import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Type } from '@nestjs/common';
import { CreateInstallmentPurchaseController } from '@modules/transaction/features/create-installment-purchase/create-installment-purchase.controller';
import { CreateRecurringTransactionController } from '@modules/transaction/features/create-recurring-transaction/create-recurring-transaction.controller';
import { CreateTransactionController } from '@modules/transaction/features/create-transaction/create-transaction.controller';
import { PayCreditCardInvoiceController } from '@modules/transaction/features/pay-credit-card-invoice/pay-credit-card-invoice.controller';
import { IDEMPOTENCY_KEY } from '@providers/auth/decorators/Idempotency.decorator';
import { IdempotencyGuard } from '@providers/auth/guards/Idempotency.guard';

function guardsOf(controller: Type<unknown>): unknown[] {
  const classGuards: unknown[] =
    Reflect.getMetadata(GUARDS_METADATA, controller) ?? [];
  const methodGuards: unknown[] =
    Reflect.getMetadata(GUARDS_METADATA, controller.prototype.handle) ?? [];

  return [...classGuards, ...methodGuards];
}

function idempotentMetadataOf(controller: Type<unknown>): unknown {
  return Reflect.getMetadata(IDEMPOTENCY_KEY, controller.prototype.handle);
}

describe('idempotency route coverage', () => {
  it('protects POST /transaction (create-transaction) with IdempotencyGuard', () => {
    expect(guardsOf(CreateTransactionController)).toContain(IdempotencyGuard);
  });

  it('decorates POST /transaction (create-transaction) with @Idempotent', () => {
    expect(idempotentMetadataOf(CreateTransactionController)).toBeDefined();
  });

  it('protects POST /transaction/recurring with IdempotencyGuard', () => {
    expect(guardsOf(CreateRecurringTransactionController)).toContain(
      IdempotencyGuard,
    );
  });

  it('decorates POST /transaction/recurring with @Idempotent', () => {
    expect(
      idempotentMetadataOf(CreateRecurringTransactionController),
    ).toBeDefined();
  });

  it('protects POST /transaction/installment-purchase with IdempotencyGuard', () => {
    expect(guardsOf(CreateInstallmentPurchaseController)).toContain(
      IdempotencyGuard,
    );
  });

  it('decorates POST /transaction/installment-purchase with @Idempotent', () => {
    expect(
      idempotentMetadataOf(CreateInstallmentPurchaseController),
    ).toBeDefined();
  });

  it('protects POST /account/:id/invoice/pay with IdempotencyGuard', () => {
    expect(guardsOf(PayCreditCardInvoiceController)).toContain(
      IdempotencyGuard,
    );
  });

  it('decorates POST /account/:id/invoice/pay with @Idempotent', () => {
    expect(idempotentMetadataOf(PayCreditCardInvoiceController)).toBeDefined();
  });
});
