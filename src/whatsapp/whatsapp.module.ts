import { Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [WhatsappController],
  // فقط یک بار providers داریم و همه سرویس‌ها را داخل آن می‌گذاریم
  providers: [WhatsappService, PrismaService], 
})
export class WhatsappModule {}