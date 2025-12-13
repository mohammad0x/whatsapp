import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { AuthModule } from './auth/auth.module'; // اضافه شدن ماژول لاگین
import { PrismaService } from './prisma/prisma.service';

@Module({
  imports: [
    WhatsappModule, 
    AuthModule // ماژول جدید
  ],
  controllers: [AppController],
  providers: [AppService, PrismaService],
  exports: [PrismaService],
})
export class AppModule {}