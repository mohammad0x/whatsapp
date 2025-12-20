import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { AuthModule } from './auth/auth.module';
import { CrmModule } from './crm/crm.module';
import { QueueModule } from './queue/queue.module'; // ✅ اضافه شد

@Module({
  imports: [
    WhatsappModule, 
    AuthModule, 
    CrmModule, // 👈 کاما فراموش نشود
    QueueModule // ✅ ماژول جدید
  ],
  controllers: [AppController],
  providers: [AppService, PrismaService],
})
export class AppModule {}