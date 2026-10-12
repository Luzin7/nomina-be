import { AuthSession } from '@modules/user/entities/AuthSession';

export abstract class AuthSessionsRepository {
  abstract create(authSession: AuthSession): Promise<AuthSession>;

  abstract save(authSession: AuthSession): Promise<void>;

  abstract findUniqueById(id: string): Promise<AuthSession | null>;

  abstract revoke(id: string): Promise<void>;

  abstract delete(id: string): Promise<void>;
}
