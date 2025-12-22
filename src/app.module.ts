import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { AuthModule } from './auth/auth.module';
import { CrmModule } from './crm/crm.module';
import { QueueModule } from './queue/queue.module'; 
import { EventsGateway } from './events.gateway';
import { ConfigModule } from '@nestjs/config'; // ✅ ۱. این خط اضافه شود

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    WhatsappModule, 
    AuthModule, 
    CrmModule, // 👈 کاما فراموش نشود
    QueueModule // ✅ ماژول جدید
  ],
  controllers: [AppController],
  providers: [AppService, PrismaService,EventsGateway],
})
export class AppModule {}