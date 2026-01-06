import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { PrismaService } from '../prisma/prisma.service'; // 👈 اضافه کردن سرویس دیتابیس

@Injectable()
export class OtpService {
  constructor(
    private whatsappService: WhatsappService,
    private prisma: PrismaService // 👈 تزریق سرویس دیتابیس
  ) {}

  // 👇 آرگومان userId را اضافه کردیم تا بدانیم چه کسی درخواست داده
  async sendOtp(sessionId: string, phone: string, code: string, userId: number, brand?: string) {
    
    // 🔒 ۱. بررسی سطح دسترسی (مهم)
    const agent = await this.prisma.agent.findFirst({
        where: { userId: userId }
    });

    // اگر کاربر ایجنت باشد و مجوز OTP نداشته باشد، ارور می‌دهیم
    if (agent && agent.canUseOtp === false) {
        throw new ForbiddenException('⛔ شما مجوز استفاده از سرویس رمز پویا (OTP) را ندارید.');
    }

    // تمیز کردن شماره
    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.startsWith('09')) cleanPhone = '98' + cleanPhone.substring(1);

    const brandName = brand || 'سامانه هوشمند';
    
    // قالب‌بندی پیام واتساپ
    const message = `
*کد تایید شما: ${brandName}*

🔐 کد ورود:
\`\`\`${code}\`\`\`

⚠️ لطفاً این کد را در اختیار دیگران قرار ندهید.
`.trim();

    try {
      // 🚀 ارسال پیام با هویت کاربر (نه ادمین)
      // این کار باعث می‌شود اگر ایجنت مجوز "ارسال پیام" را هم نداشته باشد، خود به خود توسط sendTextMessage مسدود شود.
      const result = await this.whatsappService.sendTextMessage(sessionId, cleanPhone, message, userId);
      
      return {
        success: true,
        message: 'کد با موفقیت ارسال شد',
        messageId: result.messageId,
        recipient: cleanPhone
      };
    } catch (error: any) {
      console.error('OTP Error:', error);
      // اگر خطا مربوط به دسترسی بود، همان را برگردان
      if (error instanceof ForbiddenException) throw error;
      
      throw new BadRequestException('خطا در ارسال کد: ' + error.message);
    }
  }
}