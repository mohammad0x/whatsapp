import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { AuthModule } from './auth/auth.module';
import { CrmModule } from './crm/crm.module';
import { QueueModule } from './queue/queue.module'; 
import { EventsGateway } from './events.gateway';
import { ConfigModule } from '@nestjs/config';
import { OtpController } from './otp/otp.controller';
import { OtpService } from './otp/otp.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    WhatsappModule, 
    AuthModule, 
    CrmModule, // 👈 کاما فراموش نشود
    QueueModule // ✅ ماژول جدید
  ],
  controllers: [AppController,OtpController],
  providers: [AppService, PrismaService,EventsGateway,OtpService],
})
export class AppModule {}