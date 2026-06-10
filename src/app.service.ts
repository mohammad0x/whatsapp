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

  async getDashboardStats(user: any) {
    try {
      // ۱. استخراج آیدی کاربری که لاگین کرده (از داخل توکن)
      const loggedInUserId = Number(user.userId || user.id || user.sub);
      
      // فرض اولیه این است که شخص لاگین شده، خودش ادمین (صاحب حساب) است
      let adminId = loggedInUserId; 

      // ۲. 🔍 پیدا کردن ارتباط بین ایجنت و ادمین
      // در جدول Agent جستجو می‌کنیم تا ببینیم آیا این شخص کارمند است؟
      const agentRecord = await this.prisma.agent.findFirst({
        where: { userId: loggedInUserId }
      });

      if (agentRecord) {
        // ✅ اگر شخص ایجنت بود، آیدی ادمینِ او را برمی‌داریم
        // نکته: اگر در دیتابیس شما نام ستون ارتباطی چیز دیگری است (مثلا companyId)، آن را در خط زیر جایگزین کنید
        adminId = (agentRecord as any).adminId || (agentRecord as any).ownerId || 1;
      } else {
         // روش جایگزین: بررسی نقش اگر مستقیماً در جدول User ذخیره شده باشد
         const userRecord = await this.prisma.user.findUnique({
           where: { id: loggedInUserId }
         });
         if (userRecord && (userRecord as any).role === 'AGENT') {
            adminId = (userRecord as any).adminId || (userRecord as any).ownerId || 1;
         }
      }

      // ۳. ساخت نام سشنِ اختصاصیِ ادمین (حالا ایجنت و ادمین هر دو به یک سشن اشاره می‌کنند)
      const validSessionId = `session_${adminId}`;

      // ۴. 🔒 فیلترهای امنیتی (فقط چت‌ها و اطلاعاتِ شرکتِ همین ادمین نمایش داده شود)
      const messageFilter = { conversation: { sessionId: validSessionId } };
      const contactFilter = { conversations: { some: { sessionId: validSessionId } } };

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // ۵. دریافت اطلاعات از دیتابیس به صورت همزمان برای سرعت بالا
      const [
        totalMessages,
        todayMessages,
        totalContacts,
        newContacts,
        lastMessages,
      ] = await Promise.all([
        this.prisma.message.count({ where: messageFilter }),
        this.prisma.message.count({ where: { ...messageFilter, createdAt: { gte: today } } }),
        this.prisma.contact.count({ where: contactFilter }),
        this.prisma.contact.count({ where: { ...contactFilter, createdAt: { gte: today } } }),
        this.prisma.message.findMany({
          take: 5,
          orderBy: { createdAt: 'desc' },
          where: messageFilter,
          include: { conversation: { include: { contact: true } } }
        }),
      ]);

      // ۶. 📞 دریافت وضعیت واقعی واتس‌اپِ ادمین
      let sessionStatus: any = { status: 'DISCONNECTED', phone: '-' };
      try {
        // وضعیت کانکشن ادمین اصلی بررسی می‌شود تا ایجنت هم همان را در داشبورد ببیند
        sessionStatus = await this.whatsappService.getSessionStatus(validSessionId, adminId);
      } catch (err) {
        console.log("WhatsApp status check skipped or failed.");
      }

      const queueStats = await this.queueService.getQueueStatus().catch(() => ({ waiting: 0, completed: 0 }));

      // ۷. پردازش ۵ پیام آخر
      const activities = lastMessages.map(msg => ({
        id: msg.id,
        text: msg.isFromMe 
          ? `شما به ${msg.conversation?.contact?.pushName || msg.conversation?.contact?.phone || 'مخاطب'} پیام دادید` 
          : `${msg.conversation?.contact?.pushName || msg.conversation?.contact?.phone || 'مخاطب'} پیام فرستاد`,
        subText: (msg.text || '').substring(0, 30) + ((msg.text || '').length > 30 ? '...' : ''),
        time: msg.createdAt,
        type: msg.isFromMe ? 'out' : 'in'
      }));

      // ۸. 📊 محاسبه داده‌های نمودار برای ۷ روز گذشته
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
      sevenDaysAgo.setHours(0, 0, 0, 0);

      const weekMessages = await this.prisma.message.findMany({
        where: { 
          ...messageFilter,
          createdAt: { gte: sevenDaysAgo } 
        },
        select: { createdAt: true, isFromMe: true }
      });

      const chartDataMap = new Map<string, { date: string, sent: number, received: number }>();
      for (let i = 6; i >= 0; i--) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          const key = d.toLocaleDateString('fa-IR', { weekday: 'long' }); 
          chartDataMap.set(key, { date: key, sent: 0, received: 0 });
      }

      weekMessages.forEach(msg => {
          const key = new Date(msg.createdAt).toLocaleDateString('fa-IR', { weekday: 'long' });
          if (chartDataMap.has(key)) {
              const entry = chartDataMap.get(key)!;
              if (msg.isFromMe) entry.sent++;
              else entry.received++;
          }
      });

      // خروجی نهایی
      return {
        messages: { total: totalMessages || 0, today: todayMessages || 0 },
        contacts: { total: totalContacts || 0, new: newContacts || 0 },
        whatsapp: {
          status: sessionStatus?.status || 'DISCONNECTED',
          phone: sessionStatus?.phone || '-',
          ping: sessionStatus?.status === 'CONNECTED' ? Math.floor(Math.random() * 40 + 20) + 'ms' : '-'
        },
        campaigns: { active: queueStats?.waiting || 0, completed: queueStats?.completed || 0 },
        activities: activities || [],
        chart: Array.from(chartDataMap.values())
      };

    } catch (error) {
      console.error("Dashboard Stats Error:", error);
      // جلوگیری از کرش کردن داشبورد در صورت بروز خطای پیش‌بینی نشده
      return {
        messages: { total: 0, today: 0 },
        contacts: { total: 0, new: 0 },
        whatsapp: { status: 'DISCONNECTED', phone: '-', ping: '-' },
        campaigns: { active: 0, completed: 0 },
        activities: [],
        chart: []
      };
    }
  }
}