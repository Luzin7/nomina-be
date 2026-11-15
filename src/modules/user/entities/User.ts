import { AggregateRoot } from '@shared/core/Entities/AggregateRoot';
import { Either, left, right } from '@shared/core/errors/Either';
import { Optional } from '@shared/core/types/Optional';

const MAX_EMAIL_LENGTH = 254;

export interface UserProps {
  name: string;
  email: string;
  passwordHash: string;
  phone?: string | null;
  avatarUrl?: string | null;
  createdAt: Date;
  updatedAt?: Date | null;
}

export class User extends AggregateRoot<UserProps> {
  private constructor(props: UserProps, id?: string) {
    super(props, id);
  }

  static create(
    props: Optional<
      UserProps,
      'createdAt' | 'updatedAt' | 'phone' | 'avatarUrl'
    >,
    id?: string,
  ): Either<Error, User> {
    if (!props.name || props.name.trim().length < 4) {
      return left(
        new Error('O nome é obrigatório e deve ter pelo menos 4 caracteres.'),
      );
    }

    if (!User.isValidEmail(props.email)) {
      return left(new Error('Endereço de e-mail inválido.'));
    }

    const userProps: UserProps = {
      ...props,
      createdAt: props.createdAt ?? new Date(),
      updatedAt: props.updatedAt ?? null,
      phone: props.phone ?? null,
      avatarUrl: props.avatarUrl ?? null,
    };

    return right(new User(userProps, id));
  }

  private static isValidEmail(email: string): boolean {
    if (email.length > MAX_EMAIL_LENGTH) return false;
    if (/\s/.test(email)) return false;

    const separatorIndex = email.indexOf('@');
    if (separatorIndex < 1) return false;
    if (email.indexOf('@', separatorIndex + 1) !== -1) return false;

    const domain = email.slice(separatorIndex + 1);
    const lastDotIndex = domain.lastIndexOf('.');
    return lastDotIndex > 0 && lastDotIndex < domain.length - 1;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date | null {
    return this.props.updatedAt ?? null;
  }

  get name(): string {
    return this.props.name;
  }

  get email(): string {
    return this.props.email;
  }

  get phone(): string | null {
    return this.props.phone ?? null;
  }

  get passwordHash(): string {
    return this.props.passwordHash;
  }

  get avatarUrl(): string | null {
    return this.props.avatarUrl ?? null;
  }

  public updateProfile(
    name: string,
    phone?: string | null,
    avatarUrl?: string | null,
  ): Either<Error, void> {
    if (!name || name.trim().length < 4) {
      return left(
        new Error('O nome é obrigatório e deve ter pelo menos 4 caracteres.'),
      );
    }
    this.props.name = name;
    if (phone !== undefined) this.props.phone = phone;
    if (avatarUrl !== undefined) this.props.avatarUrl = avatarUrl;

    this.touch();
    return right(undefined);
  }

  public changeEmail(newEmail: string): Either<Error, void> {
    if (!User.isValidEmail(newEmail)) {
      return left(new Error('Endereço de e-mail inválido.'));
    }
    this.props.email = newEmail;
    this.touch();
    return right(undefined);
  }

  public changePassword(newPasswordHash: string): void {
    if (!newPasswordHash) return;
    this.props.passwordHash = newPasswordHash;
    this.touch();
  }

  private touch(): void {
    this.props.updatedAt = new Date();
  }
}
