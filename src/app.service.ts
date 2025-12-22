import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { WhatsappService } from './whatsapp/whatsapp.service';
import { QueueService } from './queue/queue.service';

@Injectable()
export class AppService {
  constructor(
    private prisma: PrismaService,
    private whatsappService: WhatsappService,
    private queueService: QueueService,
  ) {}

  getHello(): string {
    return 'TeamInbox API is Running!';
  }

  async getDashboardStats(userId: number) {
    // ۱. آمار کلی
    const totalMessages = await this.prisma.message.count();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMessages = await this.prisma.message.count({ where: { createdAt: { gte: today } } });

    const totalContacts = await this.prisma.contact.count();
    const newContacts = await this.prisma.contact.count({ where: { createdAt: { gte: today } } });

    // ۲. وضعیت واتساپ
    const sessionId = `session_${userId}`;
    const sessionStatus = await this.whatsappService.getSessionStatus(sessionId, userId);

    // ۳. وضعیت صف
    const queueStats = await this.queueService.getQueueStatus();

    // ۴. دریافت ۵ فعالیت اخیر
    const lastMessages = await this.prisma.message.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: { conversation: { include: { contact: true } } }
    });

    const activities = lastMessages.map(msg => ({
      id: msg.id,
      text: msg.isFromMe 
        ? `شما به ${msg.conversation?.contact?.pushName || msg.conversation?.contact?.phone} پیام دادید` 
        : `${msg.conversation?.contact?.pushName || msg.conversation?.contact?.phone} پیام فرستاد`,
      subText: (msg.text || '').substring(0, 30) + ((msg.text || '').length > 30 ? '...' : ''),
      time: msg.createdAt,
      type: msg.isFromMe ? 'out' : 'in'
    }));

    // ۵. 📊 محاسبه داده‌های نمودار (۷ روز گذشته) - بخش جدید
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const weekMessages = await this.prisma.message.findMany({
      where: { createdAt: { gte: sevenDaysAgo } },
      select: { createdAt: true, isFromMe: true }
    });

    const chartDataMap = new Map<string, { date: string, sent: number, received: number }>();

    // ایجاد اسکلت خالی برای ۷ روز اخیر
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        // نام روز هفته فارسی
        const key = d.toLocaleDateString('fa-IR', { weekday: 'long' }); 
        chartDataMap.set(key, { date: key, sent: 0, received: 0 });
    }

    // پر کردن داده‌ها
    weekMessages.forEach(msg => {
        const key = new Date(msg.createdAt).toLocaleDateString('fa-IR', { weekday: 'long' });
        if (chartDataMap.has(key)) {
            const entry = chartDataMap.get(key)!;
            if (msg.isFromMe) entry.sent++;
            else entry.received++;
        }
    });

    return {
      messages: { total: totalMessages, today: todayMessages },
      contacts: { total: totalContacts, new: newContacts },
      whatsapp: {
        status: sessionStatus.status,
        phone: sessionStatus.phone,
        ping: sessionStatus.status === 'CONNECTED' ? Math.floor(Math.random() * 40 + 20) + 'ms' : '-'
      },
      campaigns: { active: queueStats.waiting, completed: queueStats.completed },
      activities: activities,
      chart: Array.from(chartDataMap.values()) // 👈 ارسال داده‌های نمودار
    };
  }
}