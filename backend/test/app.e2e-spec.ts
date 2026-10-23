import { type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { promises as fs } from 'node:fs';
import { type Server } from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import request from 'supertest';
import { SystemController } from '../src/system/system.controller';
import { SystemService } from '../src/system/system.service';

// Deliberately do not import AppModule: an HTTP regression must never load a
// developer's .env, real media, database, credentials, or automatic jobs.
describe('Directory API access boundaries (e2e)', () => {
  let app: INestApplication<Server>;
  let temp: string;
  let root: string;
  let outside: string;
  const transportPath = (value: string) => value.replace(/\\/g, '/');

  beforeEach(async () => {
    temp = await fs.mkdtemp(path.join(os.tmpdir(), 'subsarr-directory-http-'));
    root = path.join(temp, 'media');
    outside = path.join(temp, 'outside');
    await fs.mkdir(root);
    await fs.mkdir(outside);
    await fs.mkdir(path.join(root, 'Café'));
    await fs.writeFile(path.join(root, 'episode.srt'), 'fixture');
    await fs.writeFile(path.join(outside, 'private.txt'), 'not visible');
    const module = await Test.createTestingModule({
      controllers: [SystemController],
      providers: [
        SystemService,
        {
          provide: ConfigService,
          useValue: { getOrThrow: () => ({ mediaDirs: [root] }) },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    if (app) await app.close();
    if (temp) await fs.rm(temp, { recursive: true, force: true });
  });

  it('lists only configured roots when no path is requested', async () => {
    const canonical = await fs.realpath(root);
    await request(app.getHttpServer())
      .get('/system/directory')
      .expect(200)
      .expect([
        { name: canonical, path: transportPath(canonical), isDirectory: true },
      ]);
  });

  it('returns actual Unicode directory and file entries with directories first', async () => {
    const canonical = await fs.realpath(root);
    await request(app.getHttpServer())
      .get('/system/directory')
      .query({ path: root })
      .expect(200)
      .expect([
        {
          name: 'Café',
          path: transportPath(path.join(canonical, 'Café')),
          isDirectory: true,
        },
        {
          name: 'episode.srt',
          path: transportPath(path.join(canonical, 'episode.srt')),
          isDirectory: false,
        },
      ]);
  });

  it('rejects paths outside the configured media boundary', async () => {
    await request(app.getHttpServer())
      .get('/system/directory')
      .query({ path: outside })
      .expect(400);
  });

  it('rejects symlink escapes rather than listing the linked private files', async () => {
    const escape = path.join(root, 'escape');
    await fs.symlink(
      outside,
      escape,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await request(app.getHttpServer())
      .get('/system/directory')
      .query({ path: escape })
      .expect(400);
  });

  it('reports an inaccessible root as an error instead of a successful empty listing', async () => {
    await fs.rm(root, { recursive: true });
    await request(app.getHttpServer()).get('/system/directory').expect(400);
  });
});
