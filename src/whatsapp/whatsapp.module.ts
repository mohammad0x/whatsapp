import { Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';
import { PrismaService } from '../prisma/prisma.service'; // دو نقطه برای خروج از پوشه

@Module({
  controllers: [WhatsappController],
  providers: [WhatsappService, PrismaService],
})
export class WhatsappModule {}