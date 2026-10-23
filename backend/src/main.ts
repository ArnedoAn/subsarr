import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import {
  json,
  urlencoded,
  type Request,
  type Response,
  type NextFunction,
} from 'express';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
    bodyParser: false,
  });
  app.enableShutdownHooks(['SIGTERM', 'SIGINT']);
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: false, limit: '64kb' }));
  // A bounded process-wide cap protects the single-user LAN service without authentication.
  let windowStart = Date.now();
  let requests = 0;
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/health') return next();
    const now = Date.now();
    if (now - windowStart >= 60_000) {
      windowStart = now;
      requests = 0;
    }
    if (++requests > 1200) {
      res.setHeader('Retry-After', '60');
      res.status(429).json({ message: 'Request rate limit exceeded' });
      return;
    }
    next();
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  // Browser requests use the same-origin Next /api proxy; no wildcard CORS.

  const port = process.env.PORT ?? 3001;
  await app.listen(port);

  logger.log(`Application started on port ${port}`);
  logger.log(`Media dirs: ${process.env.SUBSYNC_MEDIA_DIRS || '/media'}`);
  logger.log(
    `Settings file: ${process.env.SUBSYNC_SETTINGS_FILE_PATH || 'not set'}`,
  );
}
void bootstrap();
