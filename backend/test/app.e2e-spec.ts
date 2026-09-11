import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  // Never leaked before this fix: a full AppModule (its own PrismaClient
  // connection pool) was created fresh in beforeEach with no matching
  // afterEach — since this file sorts alphabetically first among all
  // *.e2e-spec.ts files, that leaked pool sat open for the entire rest of
  // a combined run, competing for scratch-Postgres connections against
  // every subsequent file's own pool (see the Sprint 18 investigation into
  // the long-documented combined-run hang).
  afterEach(async () => {
    await app.close();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });
});
