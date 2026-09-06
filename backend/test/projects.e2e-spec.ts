import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

describe('Projects (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const createdEmails: string[] = [];

  const uniqueEmail = (label: string) => {
    const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    createdEmails.push(email);
    return email;
  };

  const registerUser = async (label: string) => {
    const email = uniqueEmail(label);
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'Sup3rSecret1' });
    return { email, accessToken: res.body.accessToken as string };
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
  });

  afterAll(async () => {
    if (createdEmails.length) {
      await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
    }
    await app.close();
  });

  describe('CRUD + lifecycle for the owning user', () => {
    let token: string;
    let projectId: string;

    beforeAll(async () => {
      const user = await registerUser('owner');
      token = user.accessToken;
    });

    it('creates a project, forcing status to DRAFT and ignoring client fields', async () => {
      const res = await request(app.getHttpServer())
        .post('/projects')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: '  Interview Prep Platform  ',
          brief: 'Build an AI-powered mock interview platform.',
          preferredStack: 'React + NestJS + PostgreSQL',
          repositoryType: 'NEW',
          // Attempts to smuggle fields the DTO doesn't allow; the global
          // ValidationPipe (forbidNonWhitelisted) should reject the request.
        })
        .expect(201);

      projectId = res.body.id;
      expect(res.body.status).toBe('DRAFT');
      expect(res.body.name).toBe('Interview Prep Platform');
    });

    it('rejects a create payload with an unknown field', async () => {
      await request(app.getHttpServer())
        .post('/projects')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'X', brief: 'Y', status: 'COMPLETED' })
        .expect(400);
    });

    it('rejects a create payload missing required fields', async () => {
      await request(app.getHttpServer())
        .post('/projects')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: '' })
        .expect(400);
    });

    it('lists only active projects by default', async () => {
      const res = await request(app.getHttpServer())
        .get('/projects')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.some((p: { id: string }) => p.id === projectId)).toBe(
        true,
      );
    });

    it('gets the project detail', async () => {
      const res = await request(app.getHttpServer())
        .get(`/projects/${projectId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.id).toBe(projectId);
    });

    it('updates editable fields but ignores status/userId in the payload', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/projects/${projectId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Updated Name', status: 'COMPLETED' })
        .expect(400); // status is not part of UpdateProjectDto -> whitelist rejection

      expect(res.body.message).toEqual(
        expect.arrayContaining([expect.stringContaining('status')]),
      );
    });

    it('updates editable fields with a valid payload', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/projects/${projectId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Updated Name' })
        .expect(200);

      expect(res.body.name).toBe('Updated Name');
      expect(res.body.status).toBe('DRAFT');
    });

    it('clears repositoryUrl when switching to NEW via update', async () => {
      await request(app.getHttpServer())
        .patch(`/projects/${projectId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          repositoryType: 'EXISTING',
          repositoryUrl: 'https://github.com/example/repo',
        })
        .expect(200);

      const switched = await request(app.getHttpServer())
        .patch(`/projects/${projectId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ repositoryType: 'NEW' })
        .expect(200);

      expect(switched.body.repositoryUrl).toBeNull();
    });

    it('archives the project and excludes it from the default list', async () => {
      const archiveRes = await request(app.getHttpServer())
        .post(`/projects/${projectId}/archive`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(archiveRes.body.archivedAt).not.toBeNull();

      const listRes = await request(app.getHttpServer())
        .get('/projects')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(listRes.body.some((p: { id: string }) => p.id === projectId)).toBe(
        false,
      );
    });

    it('is retrievable via the archived filter', async () => {
      const res = await request(app.getHttpServer())
        .get('/projects?archived=true')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.some((p: { id: string }) => p.id === projectId)).toBe(
        true,
      );
    });

    it('archiving again is idempotent', async () => {
      await request(app.getHttpServer())
        .post(`/projects/${projectId}/archive`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('restores the archived project', async () => {
      const res = await request(app.getHttpServer())
        .post(`/projects/${projectId}/restore`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.archivedAt).toBeNull();

      const listRes = await request(app.getHttpServer())
        .get('/projects')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(listRes.body.some((p: { id: string }) => p.id === projectId)).toBe(
        true,
      );
    });

    it('deletes the project permanently', async () => {
      await request(app.getHttpServer())
        .delete(`/projects/${projectId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/projects/${projectId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('authentication', () => {
    it('rejects unauthenticated access to every project route', async () => {
      await request(app.getHttpServer()).get('/projects').expect(401);
      await request(app.getHttpServer())
        .post('/projects')
        .send({ name: 'X', brief: 'Y' })
        .expect(401);
    });
  });

  describe('ownership isolation between users', () => {
    let ownerToken: string;
    let otherToken: string;
    let ownerProjectId: string;

    beforeAll(async () => {
      const owner = await registerUser('iso-owner');
      const other = await registerUser('iso-other');
      ownerToken = owner.accessToken;
      otherToken = other.accessToken;

      const res = await request(app.getHttpServer())
        .post('/projects')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Owner Project',
          brief: 'Only the owner should see this.',
        });
      ownerProjectId = res.body.id;
    });

    it('prevents another user from viewing the project (404, not 403)', async () => {
      await request(app.getHttpServer())
        .get(`/projects/${ownerProjectId}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
    });

    it("excludes the owner's project from another user's list", async () => {
      const res = await request(app.getHttpServer())
        .get('/projects')
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(200);

      expect(
        res.body.some((p: { id: string }) => p.id === ownerProjectId),
      ).toBe(false);
    });

    it('prevents another user from updating the project', async () => {
      await request(app.getHttpServer())
        .patch(`/projects/${ownerProjectId}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ name: 'Hijacked' })
        .expect(404);
    });

    it('prevents another user from archiving the project', async () => {
      await request(app.getHttpServer())
        .post(`/projects/${ownerProjectId}/archive`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
    });

    it('prevents another user from deleting the project', async () => {
      await request(app.getHttpServer())
        .delete(`/projects/${ownerProjectId}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
    });

    it('leaves the project intact and visible to its real owner', async () => {
      await request(app.getHttpServer())
        .get(`/projects/${ownerProjectId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);
    });
  });
});
