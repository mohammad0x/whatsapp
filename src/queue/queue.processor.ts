import { Process, Processor } from '@nestjs/bull';
import type { Job } from 'bull'; // ✅ تغییر به import type
import { WhatsappService } from '../whatsapp/whatsapp.service';

@Processor('message-queue')
export class QueueProcessor {
  constructor(private readonly whatsappService: WhatsappService) {}

  @Process('send-message')
  async handleSendMessage(job: Job) {
    const { sessionId, phone, message, mediaUrl, userId } = job.data;

    console.log(`🔄 Processing job for ${phone} (Job ID: ${job.id})`);

    const randomDelay = Math.floor(Math.random() * 8000) + 2000;
    await new Promise(r => setTimeout(r, randomDelay));

    try {
        if (mediaUrl) {
            await this.whatsappService.sendTextMessage(sessionId, phone, message + `\n\n(لینک فایل: ${mediaUrl})`, userId);
        } else {
            await this.whatsappService.sendTextMessage(sessionId, phone, message, userId);
        }
        console.log(`✅ Sent to ${phone}`);
    } catch (error) {
        console.error(`❌ Failed to send to ${phone}: ${error.message}`);
        throw error;
    }
  }
}