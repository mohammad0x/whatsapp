import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ChatbotService {
  constructor(private prisma: PrismaService) {}

  /**
   * پیدا کردن پاسخ هوشمند بر اساس کاربر و متن ورودی
   * @param userId آیدی عددی کاربر صاحب ربات
   * @param incomingText متن پیام دریافتی
   */
  async getResponse(userId: number, incomingText: string): Promise<string | null> {
    const cleanText = incomingText.trim().toLowerCase();

    // جستجو در جدول کلمات کلیدی مخصوص همین کاربر
    const keyword = await this.prisma.keyword.findFirst({
      where: {
        userId: userId,
        trigger: cleanText,
      },
    });

    // اگر کلمه‌ای پیدا شد، پاسخش را برگردان، وگرنه null
    return keyword ? keyword.response : null;
  }
}