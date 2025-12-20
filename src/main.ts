import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  console.log('DEBUG: SUPABASE_URL:', process.env.SUPABASE_URL);
  console.log('DEBUG: ConfigService URL:', app.get(ConfigService).get('SUPABASE_URL'));

  // Enable Global Prefix
  app.setGlobalPrefix('api');

  // Enable CORS
  app.enableCors({
    origin: '*', // Allow all origins for now to fix the issue
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type, Accept, Authorization',
    credentials: true,
  });

  // Manual middleware to handle the Private Network Access preflight if needed
  app.use((req, res, next) => {
    if (req.headers['access-control-request-private-network']) {
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    next();
  });

  await app.listen(process.env.PORT ?? 8080);
}
bootstrap();
