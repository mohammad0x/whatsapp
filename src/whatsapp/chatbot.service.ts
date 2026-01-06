import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleGenerativeAI } from '@google/generative-ai';

@Injectable()
export class ChatbotService {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor(private prisma: PrismaService) {
    const apiKey = process.env.GEMINI_API_KEY;
    
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
      // مدل gemini-pro یا gemini-1.5-flash (که سریع‌تر است)
      this.model = this.genAI.getGenerativeModel({ model: "gemini-pro" });
    } else {
      console.warn("⚠️ GEMINI_API_KEY is not set in .env file");
    }
  }

  /**
   * سناریوی ترکیبی: اول کلمات کلیدی، دوم هوش مصنوعی
   */
  async getResponse(userId: number, incomingText: string): Promise<string | null> {
    if (!incomingText) return null;
    const cleanText = incomingText.trim().toLowerCase();

    // -----------------------------------------------------------
    // 🔒 اولویت ۱: کلمات کلیدی (Database)
    // -----------------------------------------------------------
    const keyword = await this.prisma.keyword.findFirst({
      where: {
        userId: userId,
        trigger: cleanText,
      },
    });

    if (keyword) {
      // console.log(`✅ Keyword Hit: ${cleanText}`); // برای پروداکشن لاگ زیاد نیندازیم بهتر است
      return keyword.response;
    }

    // -----------------------------------------------------------
    // 🤖 اولویت ۲: هوش مصنوعی (Gemini)
    // -----------------------------------------------------------
    
    // دریافت تنظیمات سشن کاربر
    const sessionId = `session_${userId}`;
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });

    // شرط اجرا: سشن باشد + دکمه AI روشن باشد + مدل لود شده باشد
    if (session && session.aiEnabled && this.model) {
      return this.askGemini(incomingText);
    }

    return null;
  }

  // 👇 تابع تماس با گوگل
  private async askGemini(userPrompt: string): Promise<string | null> {
    try {
      // دستورالعمل سیستم (شخصیت ربات)
      const systemInstruction = `
      تو یک دستیار هوشمند واتساپ هستی.
      - پاسخ‌هایت کوتاه (حداکثر ۳ خط)، دوستانه و به زبان فارسی باشد.
      - از ایموجی استفاده کن.
      - اگر سوال توهین‌آمیز بود، مودبانه بحث را عوض کن.
      `;

      // ترکیب دستورالعمل با پیام کاربر
      const prompt = `${systemInstruction}\n\nپیام کاربر: ${userPrompt}`;
      
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return response.text().trim();
      
    } catch (error) {
      console.error("❌ Gemini API Error:", error);
      return null; // در صورت خطا چیزی ارسال نشود
    }
  }
}