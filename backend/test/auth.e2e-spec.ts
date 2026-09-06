import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let config: ConfigService;
  const createdEmails: string[] = [];

  const uniqueEmail = (label: string) => {
    const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    createdEmails.push(email);
    return email;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    config = moduleFixture.get(ConfigService);
  });

  afterAll(async () => {
    if (createdEmails.length) {
      await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    }
    await app.close();
  });

  describe('POST /auth/register', () => {
    it('registers a new user with a hashed password', async () => {
      const email = uniqueEmail('register');

      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email,
          password: 'Sup3rSecret1',
          firstName: 'Ada',
          lastName: 'Lovelace',
        })
        .expect(201);

      expect(res.body.user.email).toBe(email);
      expect(res.body.user).not.toHaveProperty('passwordHash');
      expect(res.body.user).not.toHaveProperty('refreshTokenHash');
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.refreshToken).toEqual(expect.any(String));

      const stored = await prisma.user.findUnique({ where: { email } });
      expect(stored).not.toBeNull();
      expect(stored?.passwordHash).not.toBe('Sup3rSecret1');
    });

    it('rejects a duplicate email', async () => {
      const email = uniqueEmail('dup');
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: 'Sup3rSecret1' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: 'Sup3rSecret1' })
        .expect(409);
    });

    it('rejects an invalid email', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'not-an-email', password: 'Sup3rSecret1' })
        .expect(400);
    });

    it('rejects a weak password', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: uniqueEmail('weak'), password: 'short' })
        .expect(400);
    });
  });

  describe('POST /auth/login', () => {
    const email = uniqueEmail('login');
    const password = 'Sup3rSecret1';

    beforeAll(async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password });
    });

    it('logs in with valid credentials', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(200);

      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.refreshToken).toEqual(expect.any(String));
    });

    it('rejects a wrong password', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'WrongPassword1' })
        .expect(401);
    });

    it('rejects an unknown email', async () => {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'nobody-here@example.com', password: 'whatever1' })
        .expect(401);
    });
  });

  describe('protected route + refresh + logout flow', () => {
    const email = uniqueEmail('flow');
    const password = 'Sup3rSecret1';
    let accessToken: string;
    let refreshToken: string;

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password, firstName: 'Grace', lastName: 'Hopper' });
      accessToken = res.body.accessToken;
      refreshToken = res.body.refreshToken;
    });

    it('rejects /auth/me with no token', async () => {
      await request(app.getHttpServer()).get('/auth/me').expect(401);
    });

    it('rejects /auth/me with an invalid token', async () => {
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', 'Bearer not-a-real-token')
        .expect(401);
    });

    it('rejects /auth/me with an expired token', async () => {
      const jwt = new JwtService();
      const expired = await jwt.signAsync(
        { sub: 'whoever', email, type: 'access' },
        { secret: config.get<string>('JWT_ACCESS_SECRET'), expiresIn: '-1s' },
      );

      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${expired}`)
        .expect(401);
    });

    it('returns the authenticated profile with a valid token', async () => {
      const res = await request(app.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.email).toBe(email);
      expect(res.body).not.toHaveProperty('passwordHash');
    });

    it('rejects an invalid refresh token', async () => {
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken: 'not-a-real-token' })
        .expect(401);
    });

    it('rotates tokens with a valid refresh token', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.refreshToken).not.toBe(refreshToken);

      accessToken = res.body.accessToken;
      refreshToken = res.body.refreshToken;
    });

    it('logs out successfully', async () => {
      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send()
        .expect(200);
    });

    it('rejects the refresh token as unusable after logout', async () => {
      await request(app.getHttpServer())
        .post('/auth/refresh')
        .send({ refreshToken })
        .expect(401);
    });

    it('logout is idempotent when called again', async () => {
      await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send()
        .expect(200);
    });
  });
});
