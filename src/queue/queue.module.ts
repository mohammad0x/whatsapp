import { Module, forwardRef } from '@nestjs/common'; // 👈 forwardRef اضافه شد
import { BullModule } from '@nestjs/bull';
import { QueueService } from './queue.service';
import { QueueProcessor } from './queue.processor';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [
    BullModule.forRoot({
      redis: {
        host: 'localhost',
        port: 6379,
      },
    }),
    BullModule.registerQueue({
      name: 'message-queue',
    }),
    forwardRef(() => WhatsappModule), // 👈 استفاده از forwardRef برای حل مشکل حلقه
  ],
  providers: [QueueService, QueueProcessor],
  exports: [QueueService],
})
export class QueueModule {}