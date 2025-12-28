import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt'; // برای هش کردن پسورد
@Injectable()
export class CrmService {
  constructor(private prisma: PrismaService) {}

  // --- مدیریت مکالمات ---
  
  // تغییر وضعیت (بستن/باز کردن تیکت)
  async updateConversationStatus(convId: number, status: string) {
    return this.prisma.conversation.update({
      where: { id: convId },
      data: { status }
    });
  }

  // اختصاص دادن به اپراتور
  async assignConversation(convId: number, agentId: number | null) {
    return this.prisma.conversation.update({
      where: { id: convId },
      data: { assignedTo: agentId }
    });
  }

  // --- مدیریت پروفایل مشتری ---

  // دریافت اطلاعات کامل (تگ‌ها، نوت‌ها، تاریخچه)
  async getContactDetails(phone: string) {
    return this.prisma.contact.findUnique({
      where: { phone },
      include: {
        tags: true,
        notes: { orderBy: { createdAt: 'desc' } },
        conversations: {
           orderBy: { createdAt: 'desc' },
           take: 5 
        }
      }
    });
  }

  // افزودن یادداشت محرمانه
  async addNote(contactId: number, text: string, authorName: string) {
    return this.prisma.note.create({
      data: {
        text,
        author: authorName,
        contactId
      }
    });
  }

  // --- سیستم تگ ---

  async createTag(name: string, color: string) {
    return this.prisma.tag.create({
      data: { name, color }
    });
  }

  async getAllTags() {
    return this.prisma.tag.findMany();
  }

  async addTagToContact(contactId: number, tagId: number) {
    return this.prisma.contact.update({
      where: { id: contactId },
      data: {
        tags: { connect: { id: tagId } }
      }
    });
  }

  // --- پاسخ‌های آماده (Canned Responses) ---
  
  async createCannedResponse(userId: number, shortcut: string, content: string) {
    return this.prisma.cannedResponse.create({
      data: { shortcut, content, userId }
    });
  }

  async getCannedResponses(userId: number) {
    return this.prisma.cannedResponse.findMany({
      where: { userId }
    });
  }

  // --- مدیریت ایجنت‌ها ---
  
  async createAgent(adminUserId: number, data: any) {
  // 1. ابتدا پسورد را هش می‌کنیم
  const hashedPassword = await bcrypt.hash(data.password, 10);

  // 2. ساخت یک کاربر جدید در جدول User برای اینکه بتواند لاگین کند
  const newUser = await this.prisma.user.create({
    data: {
      email: data.email,
      password: hashedPassword,
      name: data.name,
      role: 'AGENT', // 👈 نقش او را ایجنت می‌گذاریم
    }
  });

  // 3. حالا پروفایل ایجنت را می‌سازیم و به آن یوزر وصل می‌کنیم
  // (نکته: در مدل Agent باید فیلدی برای ارتباط با User داشته باشید یا صرفاً از همان User استفاده کنید)
  return this.prisma.agent.create({
    data: {
      name: data.name,
      email: data.email,
      userId: adminUserId, // این نشان می‌دهد چه کسی او را ساخته (ادمین)
      // اگر می‌خواهید لاگین ایجنت به پروفایلش وصل شود، باید یک relation جدید در prisma بسازید
      // اما برای سادگی فعلا همین کافیست.
    }
  });
}
   // در داخل کلاس CrmService اضافه کنید:

async getContacts(search?: string) {
  return this.prisma.contact.findMany({
    where: search ? {
      OR: [
        { phone: { contains: search } },
        { pushName: { contains: search } }
      ]
    } : undefined,
    include: {
      tags: true,
      _count: { select: { conversations: true } } // تعداد مکالمات
    },
    orderBy: { createdAt: 'desc' }
  });
}

  async getAgents(userId: number) {
    return this.prisma.agent.findMany({
      where: { userId }
    });
  }
  // حذف ایجنت
  async deleteAgent(agentId: number) {
    return this.prisma.agent.delete({
      where: { id: agentId },
    });
  }

  async removeTagFromContact(contactId: number, tagId: number) {
    return this.prisma.contact.update({
      where: { id: contactId },
      data: {
        tags: {
          disconnect: { id: tagId } // 👈 دستور Prisma برای حذف ارتباط
        }
      },
      include: { tags: true } // لیست جدید تگ‌ها را برگردان
    });
  }
  // حذف پاسخ آماده
  async deleteCannedResponse(id: number) {
    // بررسی وجود آیتم قبل از حذف (اختیاری ولی توصیه می‌شود)
    const exists = await this.prisma.cannedResponse.findUnique({ where: { id } });
    if (!exists) {
      throw new Error('آیتم یافت نشد');
    }

    return this.prisma.cannedResponse.delete({
      where: { id },
    });
  }
}