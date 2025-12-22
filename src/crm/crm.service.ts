import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
  
  async createAgent(userId: number, data: any) {
    return this.prisma.agent.create({
      data: {
        ...data,
        userId
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
}