import { User } from './User';

describe('User entity', () => {
  function makeProps(
    overrides: Partial<Parameters<typeof User.create>[0]> = {},
  ) {
    return {
      name: 'John Doe',
      email: 'john@example.com',
      passwordHash: 'hashed_password',
      ...overrides,
    };
  }

  describe('create()', () => {
    it('should create a valid user', () => {
      const result = User.create(makeProps());
      expect(result.isRight()).toBe(true);
    });

    it.each([
      ['abc', 'name too short'],
      ['', 'empty name'],
      ['   ', 'whitespace-only name'],
    ])('should reject name "%s" (%s)', (name) => {
      const result = User.create(makeProps({ name }));
      expect(result.isLeft()).toBe(true);
    });

    it.each([
      ['notanemail', 'missing @'],
      ['@nodomain.com', 'missing local part'],
      ['user@', 'missing domain'],
      ['', 'empty email'],
    ])('should reject email "%s" (%s)', (email) => {
      const result = User.create(makeProps({ email }));
      expect(result.isLeft()).toBe(true);
    });

    it.each([['a@b.c'], ['john.doe+tag@sub.example.com']])(
      'should accept email "%s"',
      (email) => {
        expect(User.create(makeProps({ email })).isRight()).toBe(true);
      },
    );

    it.each([
      ['two@@signs.com'],
      ['a@b@c.com'],
      ['with space@example.com'],
      ['user@nodot'],
      ['user@.com'],
      ['user@domain.'],
      ['a@....'],
      ['a@b..'],
      [`a@${'a'.repeat(260)}.com`],
    ])('should reject malformed email "%s"', (email) => {
      expect(User.create(makeProps({ email })).isLeft()).toBe(true);
    });

    it.each([
      ['dots', `a@${'.'.repeat(100000)}`],
      ['repeated labels', `a@${'a.'.repeat(100000)}`],
    ])('should reject pathological email (%s)', (_label, email) => {
      expect(User.create(makeProps({ email })).isLeft()).toBe(true);
    });

    it('should default createdAt when not provided', () => {
      const result = User.create(makeProps());
      expect(result.isRight()).toBe(true);
      if (result.isRight()) {
        expect(result.value.createdAt).toBeInstanceOf(Date);
      }
    });
  });

  describe('updateProfile()', () => {
    function makeUser() {
      const result = User.create(makeProps());
      if (result.isLeft()) throw new Error('Failed to create user');
      return result.value;
    }

    it('should update name successfully', () => {
      const user = makeUser();
      const result = user.updateProfile('Jane Doe');
      expect(result.isRight()).toBe(true);
      expect(user.name).toBe('Jane Doe');
    });

    it('should reject name shorter than 4 chars', () => {
      const user = makeUser();
      const result = user.updateProfile('Jan');
      expect(result.isLeft()).toBe(true);
    });

    it('should update phone and avatarUrl', () => {
      const user = makeUser();
      user.updateProfile('John Doe', '+5511999990000', 'https://avatar.url');
      expect(user.phone).toBe('+5511999990000');
      expect(user.avatarUrl).toBe('https://avatar.url');
    });
  });

  describe('changeEmail()', () => {
    function makeUser() {
      const result = User.create(makeProps());
      if (result.isLeft()) throw new Error('Failed to create user');
      return result.value;
    }

    it('should change email to a valid address', () => {
      const user = makeUser();
      const result = user.changeEmail('new@example.com');
      expect(result.isRight()).toBe(true);
      expect(user.email).toBe('new@example.com');
    });

    it('should reject an invalid email', () => {
      const user = makeUser();
      const result = user.changeEmail('not-an-email');
      expect(result.isLeft()).toBe(true);
    });
  });
});
