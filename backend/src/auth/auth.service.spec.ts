import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

const ENV: Record<string, string> = {
  JWT_ACCESS_SECRET: 'test-access-secret-0123456789',
  JWT_ACCESS_EXPIRES_IN: '15m',
  JWT_REFRESH_SECRET: 'test-refresh-secret-0123456789',
  JWT_REFRESH_EXPIRES_IN: '7d',
};

const configService = { get: (key: string) => ENV[key] } as any;

function buildUser(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date();
  return {
    id: 'user-1',
    email: 'user@example.com',
    passwordHash: '',
    firstName: 'Ada',
    lastName: 'Lovelace',
    isActive: true,
    refreshTokenHash: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('AuthService', () => {
  let prisma: {
    user: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let authService: AuthService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    authService = new AuthService(
      prisma as unknown as PrismaService,
      new JwtService(),
      configService,
    );
  });

  describe('register', () => {
    it('creates a user with a hashed password and returns tokens', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const created = buildUser({ passwordHash: 'hashed' });
      prisma.user.create.mockResolvedValue(created);
      prisma.user.update.mockResolvedValue(created);

      const result = await authService.register({
        email: 'User@Example.com',
        password: 'Sup3rSecret',
        firstName: 'Ada',
        lastName: 'Lovelace',
      });

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: 'user@example.com' }),
        }),
      );
      const createArgs = prisma.user.create.mock.calls[0][0];
      expect(createArgs.data.passwordHash).not.toBe('Sup3rSecret');
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result.user).not.toHaveProperty('refreshTokenHash');
      expect(result.accessToken).toEqual(expect.any(String));
      expect(result.refreshToken).toEqual(expect.any(String));
    });

    it('rejects duplicate email', async () => {
      prisma.user.findUnique.mockResolvedValue(buildUser());

      await expect(
        authService.register({
          email: 'user@example.com',
          password: 'Sup3rSecret',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('login', () => {
    it('returns tokens for valid credentials', async () => {
      const passwordHash = await bcrypt.hash('Sup3rSecret', 4);
      const user = buildUser({ passwordHash });
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.user.update.mockResolvedValue(user);

      const result = await authService.login({
        email: 'user@example.com',
        password: 'Sup3rSecret',
      });

      expect(result.user.email).toBe('user@example.com');
      expect(result.accessToken).toEqual(expect.any(String));
    });

    it('rejects an unknown user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        authService.login({
          email: 'nobody@example.com',
          password: 'whatever',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a wrong password', async () => {
      const passwordHash = await bcrypt.hash('Sup3rSecret', 4);
      prisma.user.findUnique.mockResolvedValue(buildUser({ passwordHash }));

      await expect(
        authService.login({
          email: 'user@example.com',
          password: 'WrongPassword1',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an inactive user', async () => {
      const passwordHash = await bcrypt.hash('Sup3rSecret', 4);
      prisma.user.findUnique.mockResolvedValue(
        buildUser({ passwordHash, isActive: false }),
      );

      await expect(
        authService.login({
          email: 'user@example.com',
          password: 'Sup3rSecret',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('refresh', () => {
    it('rotates tokens for a valid refresh token', async () => {
      const user = buildUser();
      const jwt = new JwtService();
      const refreshToken = await jwt.signAsync(
        { sub: user.id, type: 'refresh' },
        { secret: ENV.JWT_REFRESH_SECRET, expiresIn: '7d' },
      );
      user.refreshTokenHash = await bcrypt.hash(refreshToken, 4);
      prisma.user.findUnique.mockResolvedValue(user);
      prisma.user.update.mockResolvedValue(user);

      const result = await authService.refresh(refreshToken);

      expect(result.accessToken).toEqual(expect.any(String));
      expect(result.refreshToken).not.toBe(refreshToken);
    });

    it('rejects an invalid refresh token', async () => {
      await expect(
        authService.refresh('not-a-real-token'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a revoked refresh token (hash no longer matches)', async () => {
      const user = buildUser();
      const jwt = new JwtService();
      const refreshToken = await jwt.signAsync(
        { sub: user.id, type: 'refresh' },
        { secret: ENV.JWT_REFRESH_SECRET, expiresIn: '7d' },
      );
      // Simulate revocation: stored hash no longer corresponds to this token
      user.refreshTokenHash = await bcrypt.hash('some-other-token', 4);
      prisma.user.findUnique.mockResolvedValue(user);

      await expect(authService.refresh(refreshToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('clears the stored refresh token hash', async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 1 });

      const result = await authService.logout('user-1');

      expect(result).toEqual({ success: true });
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { refreshTokenHash: null },
      });
    });
  });
});
