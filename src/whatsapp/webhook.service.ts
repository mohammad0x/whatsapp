import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import axios from 'axios';

// 1. اینترفیس استاندارد (همانی که خودتان گذاشتید)
export interface WebhookPayload {
  object: 'whatsapp_business_account';
  entry: [{
    id: string;
    changes: [{
      value: {
        messaging_product: 'whatsapp';
        metadata: { display_phone_number: string; phone_number_id: string };
        messages?: any[];
        statuses?: any[];
      };
      field: 'messages';
    }];
  }];
}

@Injectable()
export class WebhookService {
  // کش برای سرعت بالا
  private webhookCache = new Map<string, string>();

  constructor(private prisma: PrismaService) {}

  // دریافت آدرس (با کش)
  async getUrl(sessionId: string): Promise<string | null> {
    if (this.webhookCache.has(sessionId)) return this.webhookCache.get(sessionId)!;

    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (session?.webhookUrl) {
      this.webhookCache.set(sessionId, session.webhookUrl);
      return session.webhookUrl;
    }
    return null;
  }

  // تنظیم آدرس جدید
  async setUrl(sessionId: string, url: string) {
    // ذخیره در دیتابیس
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { webhookUrl: url }
    });
    // آپدیت کش
    this.webhookCache.set(sessionId, url);
    console.log(`🔗 Webhook Updated for ${sessionId}: ${url}`);
  }

  // متد اصلی ارسال (Dispatch)
  async dispatch(sessionId: string, data: any, type: 'message' | 'status') {
    const url = await this.getUrl(sessionId);
    if (!url) return;

    // ساخت بدنه استاندارد
    const payload: WebhookPayload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: sessionId,
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: sessionId.replace(/\D/g, ''),
              phone_number_id: sessionId
            },
            ...(type === 'message' ? { messages: [data] } : { statuses: [data] })
          }
        }]
      }]
    };

    try {
      await axios.post(url, payload);
      // console.log(`📡 Sent to ${url}`);
    } catch (error: any) {
      console.error(`❌ Webhook Error: ${error.message}`);
    }
  }
}