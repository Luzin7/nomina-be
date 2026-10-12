import { RefreshTokenStatus } from '@constants/enums';
import {
  InvalidExpirationDateError,
  MissingAuthSessionError,
  MissingRefreshTokenHashError,
} from '@modules/user/errors';
import { Entity } from '@shared/core/Entities/Entity';
import { Either, left, right } from '@shared/core/errors/Either';
import { Optional } from '@shared/core/types/Optional';

export interface RefreshTokenProps {
  sessionId: string;
  tokenHash: string;
  status: RefreshTokenStatus;
  expiresAt: Date;
  createdAt: Date;
}

export class RefreshToken extends Entity<RefreshTokenProps> {
  private constructor(props: RefreshTokenProps, id?: string) {
    super(props, id);
  }

  static create(
    props: Optional<RefreshTokenProps, 'status' | 'createdAt'>,
    id?: string,
  ): Either<Error, RefreshToken> {
    const validation = RefreshToken.validate(props);
    if (validation.isLeft()) return left(validation.value);

    if (props.expiresAt <= new Date() && !id) {
      return left(new InvalidExpirationDateError());
    }

    const refreshTokenProps: RefreshTokenProps = {
      ...props,
      status: props.status ?? RefreshTokenStatus.ACTIVE,
      createdAt: props.createdAt ?? new Date(),
    };

    return right(new RefreshToken(refreshTokenProps, id));
  }

  private static validate(
    props: Optional<RefreshTokenProps, 'status' | 'createdAt'>,
  ): Either<Error, void> {
    if (!props.tokenHash) return left(new MissingRefreshTokenHashError());
    if (!props.sessionId) return left(new MissingAuthSessionError());
    if (!props.expiresAt) return left(new InvalidExpirationDateError());

    return right(undefined);
  }

  static restore(props: RefreshTokenProps, id?: string): RefreshToken {
    return new RefreshToken(props, id);
  }

  get sessionId(): string {
    return this.props.sessionId;
  }

  get tokenHash(): string {
    return this.props.tokenHash;
  }

  get status(): RefreshTokenStatus {
    return this.props.status;
  }

  get expiresAt(): Date {
    return this.props.expiresAt;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  public isActive(): boolean {
    return this.props.status === RefreshTokenStatus.ACTIVE;
  }

  public isRotated(): boolean {
    return this.props.status === RefreshTokenStatus.ROTATED;
  }

  public isRevoked(): boolean {
    return this.props.status === RefreshTokenStatus.REVOKED;
  }

  public isExpired(referenceDate: Date = new Date()): boolean {
    return this.props.expiresAt <= referenceDate;
  }

  public isReused(): boolean {
    return this.isRotated() || this.isRevoked();
  }

  public isValid(referenceDate: Date = new Date()): boolean {
    return this.isActive() && !this.isExpired(referenceDate);
  }

  public markAsRotated(): void {
    this.props.status = RefreshTokenStatus.ROTATED;
  }

  public revoke(): void {
    this.props.status = RefreshTokenStatus.REVOKED;
  }
}
