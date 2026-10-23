import { REFRESH_TOKEN_REUSE_GRACE_SECONDS } from '@constants/auth';
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
  rotatedAt: Date | null;
}

export class RefreshToken extends Entity<RefreshTokenProps> {
  private constructor(props: RefreshTokenProps, id?: string) {
    super(props, id);
  }

  static create(
    props: Optional<RefreshTokenProps, 'status' | 'createdAt' | 'rotatedAt'>,
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
      rotatedAt: props.rotatedAt ?? null,
    };

    return right(new RefreshToken(refreshTokenProps, id));
  }

  private static validate(
    props: Optional<RefreshTokenProps, 'status' | 'createdAt' | 'rotatedAt'>,
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

  get rotatedAt(): Date | null {
    return this.props.rotatedAt ?? null;
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

  public isWithinReuseGrace(now: Date): boolean {
    if (!this.isRotated() || !this.rotatedAt) return false;

    const elapsedInMs = now.getTime() - this.rotatedAt.getTime();

    return elapsedInMs < REFRESH_TOKEN_REUSE_GRACE_SECONDS * 1_000;
  }

  public markAsRotated(at: Date): void {
    this.props.status = RefreshTokenStatus.ROTATED;
    this.props.rotatedAt = at;
  }

  public revoke(): void {
    this.props.status = RefreshTokenStatus.REVOKED;
  }
}
