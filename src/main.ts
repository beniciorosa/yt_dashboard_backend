import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

// Frontend de produção + dev local. Domínios extras (previews) entram por CORS_ORIGINS.
const DEFAULT_ORIGINS = ['https://yt-dashboard-frontend.vercel.app', 'http://localhost:3000', 'http://localhost:5173'];

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api');

  // CORS_ORIGINS: lista separada por vírgula com domínios adicionais do frontend
  const origins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: [...origins, ...DEFAULT_ORIGINS],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Accept, Authorization',
  });

  // DTOs com class-validator são validados; bodies sem DTO passam como antes.
  app.useGlobalPipes(new ValidationPipe({ transform: true }));

  await app.listen(process.env.PORT ?? 8080);
}
bootstrap();
