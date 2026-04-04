import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.enableCors();

  const port = process.env.PORT ?? 3001;
  await app.listen(port);

  logger.log(`Application started on port ${port}`);
  logger.log(`Media dirs: ${process.env.SUBSYNC_MEDIA_DIRS || '/media'}`);
  logger.log(
    `Settings file: ${process.env.SUBSYNC_SETTINGS_FILE_PATH || 'not set'}`,
  );
}
void bootstrap();
