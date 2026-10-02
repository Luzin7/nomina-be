import { env } from '@infra/env';
import { VersioningType } from '@nestjs/common';
import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import '../../instrument.js';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn'],
  });

  app.enableShutdownHooks();

  app.use(helmet());

  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  const normalizeOrigin = (url: string): string =>
    url.replace(/\/+$/, '').toLowerCase();

  const allowedOrigins = new Set(
    [env.PROD_URL, env.DEV_URL, env.DEPLOY_URL].map(normalizeOrigin),
  );

  const corsOptions: CorsOptions = {
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin) return callback(null, true);
      if (!allowedOrigins.has(normalizeOrigin(origin))) {
        return callback(null, false);
      }
      return callback(null, true);
    },
    credentials: true,
    methods: 'GET,PUT,PATCH,POST,DELETE',
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
  };

  app.enableCors(corsOptions);

  const isDev = env.NODE_ENV === 'dev';

  if (isDev) {
    const config = new DocumentBuilder()
      .setTitle('Nomina API')
      .setDescription('O peso real do seu patrimônio')
      .setVersion('0.11.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(env.PORT, '0.0.0.0');
}

bootstrap().catch((err) => {
  console.error('Failed to start application:', err);
  process.exit(1);
});
