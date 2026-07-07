
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express'; // 👈 ۱. اضافه شده
import { join } from 'path'; // 👈 ۲. اضافه شده

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe());
  // تنظیمات Swagger
  
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
  });

  const config = new DocumentBuilder()
    .setTitle('WhatsApp API')
    .setDescription('API Gateway for WhatsApp')
    .setVersion('1.0')
    .addBearerAuth() // فعال کردن دکمه قفل
    .build();

  const document = SwaggerModule.createDocument(app, config);

  // 👇 تغییر اصلی اینجاست: اضافه کردن پارامتر چهارم
  SwaggerModule.setup('api', app, document, {
    swaggerOptions: {
      persistAuthorization: true, // ✅ این خط معجزه می‌کند!
    },
  });

  await app.listen(3000, '0.0.0.0');
}
bootstrap();