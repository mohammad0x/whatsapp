import { Injectable ,ForbiddenException,NotFoundException} from '@nestjs/common';
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
  
  // در فایل src/crm/crm.service.ts

  async createAgent(adminUserId: number, data: any) { // data شامل دسترسی‌ها هم هست
    // 1. هش کردن پسورد
    const hashedPassword = await bcrypt.hash(data.password, 10);

    // 2. ساخت یوزر جدید
    const newUser = await this.prisma.user.create({
      data: {
        email: data.email,
        password: hashedPassword,
        name: data.name,
        role: 'AGENT',
      }
    });

    // 3. ساخت پروفایل ایجنت با دسترسی‌های مشخص شده
    return this.prisma.agent.create({
      data: {
        name: data.name,
        email: data.email,
        userId: newUser.id, // ✅ اتصال صحیح به یوزر جدید

        // 👇 ذخیره دسترسی‌ها
        canSendMessage: data.canSendMessage ?? true, // اگر خالی بود پیش‌فرض true
        canSendImage: data.canSendImage ?? true,
        canSendFile: data.canSendFile ?? true,
        canViewInbox: data.canViewInbox ?? true,
        canViewContacts: data.canViewContacts ?? true,
        canUseOtp: data.canUseOtp ?? false,
      }
    });
  }

  async getContacts(search?: string, user?: any) {
    const where: any = {};

    // 1. فیلتر جستجو
    if (search) {
      where.OR = [
        { phone: { contains: search } },
        { pushName: { contains: search } }
      ];
    }

    // 2. فیلتر امنیتی ایجنت
    if (user && user.role === 'AGENT') {
       const agent = await this.prisma.agent.findFirst({ where: { userId: user.userId } });
       
       if (agent) {
           // 🔒 چک کردن "مجوز دسترسی" (Permission)
           // اگر تیک "مشاهده مخاطبین" برای این ایجنت خاموش باشد، ارور می‌دهد.
           if (agent.canViewContacts === false) {
               throw new ForbiddenException('⛔ شما مجوز دسترسی به لیست مخاطبین را ندارید.');
           }

           // اگر مجوز داشت، حالا فقط چت‌های خودش را می‌بیند
           where.conversations = {
               some: {
                   assignedTo: agent.id 
               }
           };
       } else {
           // اگر ایجنت پروفایل نداشت
           return [];
       }
    }

    // دریافت اطلاعات
    return this.prisma.contact.findMany({
      where,
      include: {
        tags: true,
        _count: { select: { conversations: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async getAgents() {
    return this.prisma.agent.findMany(); 
  }
  // حذف ایجنت
  // در فایل src/crm/crm.service.ts

  async deleteAgent(agentId: number) {
    // ۱. ابتدا خود ایجنت را پیدا می‌کنیم تا userId او را بفهمیم
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      select: { userId: true } // فقط userId را لازم داریم
    });

    if (!agent) {
      throw new NotFoundException('Agent not found');
    }

    // ۲. استفاده از Transaction برای حذف همزمان ایجنت و یوزر
    return this.prisma.$transaction(async (prisma) => {
      // اول: حذف پروفایل ایجنت
      await prisma.agent.delete({
        where: { id: agentId },
      });

      // دوم: حذف اکانت کاربری (User) متصل به آن
      await prisma.user.delete({
        where: { id: agent.userId },
      });
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
  // در CrmService
 // در CrmService
  async deleteCannedResponse(id: number, userId: number) { // userId اضافه شد
      // استفاده از deleteMany با شرط userId (اگر پیدا نشود یا مال کاربر نباشد، حذف نمی‌کند)
      const result = await this.prisma.cannedResponse.deleteMany({
        where: { 
          id: id,
          userId: userId // 🔒 شرط امنیتی
        },
      });

      if (result.count === 0) {
        throw new NotFoundException('آیتم یافت نشد یا شما اجازه حذف آن را ندارید.');
      }
      
      return { success: true };
    }
    async updateAgent(id: number, data: any) {
    // ۱. ابتدا ایجنت را پیدا می‌کنیم تا userId او را داشته باشیم
    const agent = await this.prisma.agent.findUnique({ where: { id } });
    if (!agent) throw new NotFoundException('ایجنت یافت نشد');

    // ۲. آماده‌سازی داده‌های آپدیت برای جدول User (ایمیل و پسورد)
    const userData: any = {};
    if (data.email) userData.email = data.email;
    
    // فقط اگر پسورد جدید ارسال شده بود، آن را هش کن و آپدیت کن
    if (data.password && data.password.length > 0) {
      userData.password = await bcrypt.hash(data.password, 10);
    }

    // آپدیت جدول User (اگر تغییری داشتیم)
    if (Object.keys(userData).length > 0) {
      await this.prisma.user.update({
        where: { id: agent.userId },
        data: userData
      });
    }

    // ۳. آپدیت جدول Agent (نام و دسترسی‌ها)
    return this.prisma.agent.update({
      where: { id },
      data: {
        name: data.name,
        email: data.email, // ایمیل را اینجا هم نگه می‌داریم برای نمایش سریع
        
        // آپدیت دسترسی‌ها
        canSendMessage: data.canSendMessage,
        canSendImage: data.canSendImage,
        canSendFile: data.canSendFile,
        canViewInbox: data.canViewInbox,
        canViewContacts: data.canViewContacts,
        canUseOtp: data.canUseOtp,
      }
    });
  }
}