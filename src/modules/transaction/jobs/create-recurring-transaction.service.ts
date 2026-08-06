import { TransactionStatus } from '@constants/enums';
import { RedisService } from '@infra/cache/redis/RedisService';
import { Injectable, Logger } from '@nestjs/common';
import { DateProvider } from '@providers/date/contracts/DateProvider';
import { Either, right } from '@shared/core/errors/Either';
import { RecurringTransaction } from '../entities/RecurringTransaction';
import { Transaction } from '../entities/Transaction';
import { RecurringTransactionRepository } from '../repositories/contracts/RecurringTransactionRepository';
import { CalculateNextGenerationDateService } from '../services/calculate-next-generation-date.service';

const BATCH_SIZE = 50;
const LOCK_TTL_SECONDS = 300;
const CACHE_TTL_SECONDS = 86400; // 24 horas
const MAX_GENERATIONS_PER_RECURRING = 365;
const TIMEZONE = 'America/Sao_Paulo';

interface Response {
  generatedCount: number;
}

@Injectable()
export class GenerateRecurringTransactionsJobService {
  private readonly logger = new Logger(
    GenerateRecurringTransactionsJobService.name,
  );

  constructor(
    private readonly recurringRepository: RecurringTransactionRepository,
    private readonly calculateNextDateService: CalculateNextGenerationDateService,
    private readonly redis: RedisService,
    private readonly dateProvider: DateProvider,
  ) {}

  async execute(): Promise<Either<Error, Response>> {
    const now = this.dateProvider.now();
    const todayStr = now.toISOString().split('T')[0];

    const lookAheadDate = new Date(now);
    lookAheadDate.setUTCDate(lookAheadDate.getUTCDate() + 7);

    const cacheKey = `processed:recurring:${todayStr}`;
    const lockKey = `lock:recurring:${todayStr}`;

    const hasAlreadyProcessed = await this.redis.exists(cacheKey);
    if (hasAlreadyProcessed) {
      this.logger.log(`Job: já processado hoje (${todayStr}), ignorando.`);
      return right({ generatedCount: 0 });
    }

    const lockAcquired = await this.redis.acquireLock(
      lockKey,
      LOCK_TTL_SECONDS,
    );
    if (!lockAcquired) {
      this.logger.log(
        `Job: lock não adquirido — outra instância já está rodando.`,
      );
      return right({ generatedCount: 0 });
    }

    try {
      let generatedCount = 0;
      let offset = 0;
      let batch: RecurringTransaction[];

      this.logger.log(
        `Job: iniciando geração. Data limite: ${lookAheadDate.toISOString()}`,
      );

      do {
        batch = await this.recurringRepository.listNeedingGeneration(
          lookAheadDate,
          BATCH_SIZE,
          offset,
        );
        offset += BATCH_SIZE;

        for (const recurring of batch) {
          const generated = await this.generateTransactionsForRecurring(
            recurring,
            lookAheadDate,
          );
          generatedCount += generated;
        }
      } while (batch.length === BATCH_SIZE);

      await this.redis.set(cacheKey, '1', CACHE_TTL_SECONDS);

      return right({ generatedCount });
    } catch (error) {
      this.logger.error('Job: erro crítico durante a execução:', error);
      throw error;
    } finally {
      await this.redis.releaseLock(lockKey);
    }
  }

  private async generateTransactionsForRecurring(
    recurring: RecurringTransaction,
    thresholdDate: Date,
  ): Promise<number> {
    const transactionsToCreate: Array<Transaction> = [];

    let targetDate = recurring.lastGenerated
      ? this.calculateNextDateService.execute(recurring, TIMEZONE)
      : recurring.startDate;

    let generationCount = 0;

    while (targetDate <= thresholdDate) {
      if (generationCount >= MAX_GENERATIONS_PER_RECURRING) {
        this.logger.warn(
          `Job: limite de segurança atingido para recorrência ${recurring.id}.`,
        );
        break;
      }

      if (recurring.endDate && targetDate > recurring.endDate) {
        recurring.deactivate();
        break;
      }

      const transactionOrError = Transaction.create({
        workspaceId: recurring.workspaceId,
        accountId: recurring.accountId,
        categoryId: recurring.categoryId,
        destinationAccountId: recurring.destinationAccountId,
        title: recurring.title,
        description: recurring.description,
        amount: recurring.amount,
        date: targetDate,
        type: recurring.type,
        status: TransactionStatus.PENDING,
        recurringId: recurring.id,
      });

      if (transactionOrError.isLeft()) {
        // A falha é determinística: os dados inválidos vêm da própria
        // recorrência (valor, categoria, conta destino), então tentar a próxima
        // data produziria exatamente o mesmo erro. Interrompe esta recorrência
        // e segue para as demais do batch.
        this.logger.error(
          `Job: recorrência ${recurring.id} tem dados inválidos, geração interrompida:`,
          transactionOrError.value,
        );
        break;
      }

      transactionsToCreate.push(transactionOrError.value);

      recurring.markAsGenerated(targetDate);

      targetDate = this.calculateNextDateService.execute(recurring, TIMEZONE);
      generationCount++;
    }

    if (transactionsToCreate.length === 0) return 0;

    await this.recurringRepository.createGeneratedTransactions(
      transactionsToCreate,
      recurring,
    );

    return transactionsToCreate.length;
  }
}
