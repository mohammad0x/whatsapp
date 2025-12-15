// import { NestFactory } from '@nestjs/core';
// import { AppModule } from './app.module';
// import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

// async function bootstrap() {
//   const app = await NestFactory.create(AppModule);
//   app.enableCors();

//   const config = new DocumentBuilder()
//     .setTitle('WhatsApp API')
//     .setDescription('The WhatsApp automation API description')
//     .setVersion('1.0')
//     // 👇 این خط جدید است: اضافه کردن قابلیت توکن
//     .addBearerAuth() 
//     .build();

//   const document = SwaggerModule.createDocument(app, config);
//   SwaggerModule.setup('api', app, document);

//   await app.listen(3000);
// }
// bootstrap();
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // تنظیمات CORS (اختیاری ولی توصیه شده)
  app.enableCors();

  // تنظیمات Swagger
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

  await app.listen(3000);
}
bootstrap();