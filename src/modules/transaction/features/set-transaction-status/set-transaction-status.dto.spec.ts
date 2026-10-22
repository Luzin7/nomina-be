import { TransactionStatus } from '@constants/enums';
import { BadRequestException } from '@nestjs/common';
import { SetTransactionStatusPipe } from './set-transaction-status.dto';

describe('SetTransactionStatusRequest DTO', () => {
  it('accepts a desired status from the transaction status enum', () => {
    expect(
      SetTransactionStatusPipe.transform({
        status: TransactionStatus.PENDING,
      }),
    ).toEqual({ status: TransactionStatus.PENDING });
  });

  it('rejects a request without the desired status', () => {
    expect(() => SetTransactionStatusPipe.transform({})).toThrow(
      BadRequestException,
    );
  });

  it('rejects a status outside the transaction status enum', () => {
    expect(() =>
      SetTransactionStatusPipe.transform({ status: 'CANCELLED' }),
    ).toThrow(BadRequestException);
  });
});
