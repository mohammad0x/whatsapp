import { Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';
import { PrismaService } from '../prisma/prisma.service'; // دو نقطه برای خروج از پوشه
import { ChatbotService } from './chatbot.service'; // 👈 اضافه شد

@Module({
  controllers: [WhatsappController],
  providers: [WhatsappService, PrismaService , ChatbotService],
})
export class WhatsappModule {}