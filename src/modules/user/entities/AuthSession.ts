import {
  InvalidExpirationDateError,
  MissingUserIdError,
} from '@modules/user/errors';
import { Entity } from '@shared/core/Entities/Entity';
import { Either, left, right } from '@shared/core/errors/Either';
import { Optional } from '@shared/core/types/Optional';

export interface AuthSessionProps {
  userId: string;
  userAgent: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export class AuthSession extends Entity<AuthSessionProps> {
  private constructor(props: AuthSessionProps, id?: string) {
    super(props, id);
  }

  static create(
    props: Optional<
      AuthSessionProps,
      'userAgent' | 'createdAt' | 'lastUsedAt' | 'revokedAt'
    >,
    id?: string,
  ): Either<Error, AuthSession> {
    const validation = AuthSession.validate(props);
    if (validation.isLeft()) return left(validation.value);

    if (props.expiresAt <= new Date() && !id) {
      return left(new InvalidExpirationDateError());
    }

    const authSessionProps: AuthSessionProps = {
      ...props,
      userAgent: props.userAgent ?? null,
      createdAt: props.createdAt ?? new Date(),
      lastUsedAt: props.lastUsedAt ?? new Date(),
      revokedAt: props.revokedAt ?? null,
    };

    return right(new AuthSession(authSessionProps, id));
  }

  private static validate(
    props: Optional<
      AuthSessionProps,
      'userAgent' | 'createdAt' | 'lastUsedAt' | 'revokedAt'
    >,
  ): Either<Error, void> {
    if (!props.userId) return left(new MissingUserIdError());
    if (!props.expiresAt) return left(new InvalidExpirationDateError());

    return right(undefined);
  }

  static restore(props: AuthSessionProps, id?: string): AuthSession {
    return new AuthSession(props, id);
  }

  get userId(): string {
    return this.props.userId;
  }

  get userAgent(): string | null {
    return this.props.userAgent ?? null;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get lastUsedAt(): Date {
    return this.props.lastUsedAt;
  }

  get expiresAt(): Date {
    return this.props.expiresAt;
  }

  get revokedAt(): Date | null {
    return this.props.revokedAt ?? null;
  }

  public isRevoked(): boolean {
    return this.props.revokedAt !== null;
  }

  public isExpired(referenceDate: Date = new Date()): boolean {
    return this.props.expiresAt <= referenceDate;
  }

  public isValid(referenceDate: Date = new Date()): boolean {
    return !this.isRevoked() && !this.isExpired(referenceDate);
  }

  public renew(expiresAt: Date, referenceDate: Date = new Date()): void {
    this.props.expiresAt = expiresAt;
    this.props.lastUsedAt = referenceDate;
  }

  public revoke(referenceDate: Date = new Date()): void {
    this.props.revokedAt = referenceDate;
  }
}
