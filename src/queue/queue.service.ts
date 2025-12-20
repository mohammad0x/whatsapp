import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull'; // ✅ تغییر به import type
// // import type { Queue } from 'bull'; // 👈 نسخه امن برای تایپ اسکریپت جدید

@Injectable()
export class QueueService {
  // اینجا چون @InjectQueue داریم، نیازی نیست نگران تایپ Queue باشیم
  constructor(@InjectQueue('message-queue') private messageQueue: Queue) {}

  async addBulkCampaign(userId: number, sessionId: string, phones: string[], message: string, mediaUrl?: string) {
    const jobs = phones.map((phone) => ({
      name: 'send-message',
      data: {
        sessionId,
        phone,
        message,
        mediaUrl,
        userId
      },
      opts: {
        attempts: 3,
        backoff: 5000,
        removeOnComplete: true,
      },
    }));

    await this.messageQueue.addBulk(jobs);
    return { status: 'queued', count: jobs.length };
  }
}