import { Injectable, BadRequestException } from '@nestjs/common';
import { WhatsappService } from '../whatsapp/whatsapp.service';

@Injectable()
export class OtpService {
  constructor(private whatsappService: WhatsappService) {}

  async sendOtp(sessionId: string, phone: string, code: string, brand?: string) {
    // تمیز کردن شماره
    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.startsWith('09')) cleanPhone = '98' + cleanPhone.substring(1);

    const brandName = brand || 'سامانه هوشمند';
    
    // قالب‌بندی پیام واتساپ (بولد و مونو‌اسپیس)
    const message = `
*کد تایید شما: ${brandName}*

🔐 کد ورود:
\`\`\`${code}\`\`\`

⚠️ لطفاً این کد را در اختیار دیگران قرار ندهید.
`.trim();

    try {
      // استفاده از سرویس اصلی واتساپ برای ارسال
      // عدد 1 شناسه کاربر ادمین است (پیش‌فرض)
      const result = await this.whatsappService.sendTextMessage(sessionId, cleanPhone, message, 1);
      
      return {
        success: true,
        message: 'کد با موفقیت ارسال شد',
        messageId: result.messageId,
        recipient: cleanPhone
      };
    } catch (error: any) {
      console.error('OTP Error:', error);
      throw new BadRequestException('خطا در ارسال کد: ' + error.message);
    }
  }
}

