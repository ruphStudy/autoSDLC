import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { PLANNING_AI_PROVIDER } from '../src/ai/planning/planning-ai.constants';
import { PlanningAIProvider } from '../src/ai/planning/contracts/planning-provider.interface';

// A stub provider so this e2e test never makes a real OpenAI call — it only
// proves the route is authenticated and wired to the DI token correctly.
const stubProvider: PlanningAIProvider = {
  generateStructuredOutput: jest.fn(),
  healthCheck: jest.fn().mockResolvedValue({
    provider: 'openai',
    configured: true,
    reachable: true,
    model: 'gpt-4o-mini',
    latencyMs: 12,
  }),
};

describe('Planning AI diagnostics (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const createdEmails: string[] = [];

  const uniqueEmail = (label: string) => {
    const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    createdEmails.push(email);
    return email;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PLANNING_AI_PROVIDER)
      .useValue(stubProvider)
      .compile();

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
  });

  afterAll(async () => {
    if (createdEmails.length) {
      await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    }
    await app.close();
  });

  it('rejects unauthenticated access', async () => {
    await request(app.getHttpServer())
      .get('/internal/ai/planning/health')
      .expect(401);
  });

  it('returns the provider health for an authenticated user', async () => {
    const email = uniqueEmail('planning-health');
    const register = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'Sup3rSecret1' });

    const res = await request(app.getHttpServer())
      .get('/internal/ai/planning/health')
      .set('Authorization', `Bearer ${register.body.accessToken}`)
      .expect(200);

    expect(res.body).toEqual({
      provider: 'openai',
      configured: true,
      reachable: true,
      model: 'gpt-4o-mini',
      latencyMs: 12,
    });
    expect(stubProvider.healthCheck).toHaveBeenCalled();
  });
});
