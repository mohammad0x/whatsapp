import { Module, forwardRef } from '@nestjs/common'; 
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';
import { PrismaService } from '../prisma/prisma.service';
import { ChatbotService } from './chatbot.service';
import { EventsGateway } from '../events.gateway';
import { QueueModule } from '../queue/queue.module'; 
import { WebhookService } from './webhook.service'; 

@Module({
  imports: [
    forwardRef(() => QueueModule) // 👈 استفاده از forwardRef برای حل مشکل حلقه
  ],
  controllers: [WhatsappController],
  providers: [
    WhatsappService, 
    PrismaService, 
    ChatbotService, 
    EventsGateway,
    WebhookService,
  ],
  exports: [WhatsappService] // 👈 حیاتی: این خط باعث می‌شود بقیه ماژول‌ها بتوانند از این سرویس استفاده کنند
})
export class WhatsappModule {}