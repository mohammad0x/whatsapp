import { Injectable } from '@nestjs/common';

@Injectable()
export class ChatbotService {
  // اینجا وضعیت کاربر را ذخیره می‌کنیم (حافظه موقت)
  private userState = new Map<string, string>();

  getResponse(phone: string, message: string): string | null {
    const text = message.trim();
    
    // --- منطق خاص شما (کلمات کلیدی) ---
    if (text.includes('کونی')) return 'باباته'; // 😂 حفظ منطق شما
    if (text.includes('قیمت')) return '💰 قیمت اشتراک ماهیانه ما ۱۰۰ هزار تومان است.';
    if (text.includes('ساعت')) return `⏰ ساعت فعلی سرور: ${new Date().toLocaleTimeString('fa-IR')}`;

    // --- سیستم منوی هوشمند ---
    const currentState = this.userState.get(phone) || 'START';

    // دکمه بازگشت کلی
    if (text === '0' || text === 'بازگشت') {
        this.userState.set(phone, 'MAIN_MENU');
        return this.getMainMenu();
    }

    switch (currentState) {
      case 'START':
      case 'MAIN_MENU':
        this.userState.set(phone, 'WAITING_FOR_OPTION');
        return this.getMainMenu();

      case 'WAITING_FOR_OPTION':
        if (text === '1') {
             this.userState.set(phone, 'PRODUCT_MENU');
             return '🛍️ *منوی محصولات:*\n۱. آیفون\n۲. سامسونگ\n\n0. بازگشت';
        }
        if (text === '2') {
             return '📞 شماره پشتیبانی: 021000000';
        }
        if (text.includes('سلام')) {
             return 'سلام دوست عزیز! 👋 چطور کمکت کنم؟ (عدد ۱ یا ۲ را بفرست)';
        }
        return '❌ گزینه اشتباه است. عدد ۱ یا ۲ را بفرستید.';

      case 'PRODUCT_MENU':
        if (text === '1') return '📱 آیفون ۱۳ موجود است: ۳۰ میلیون تومان.';
        if (text === '2') return '📱 سامسونگ S21 موجود است: ۲۵ میلیون تومان.';
        return '❌ عدد ۱ یا ۲ را بزنید (یا ۰ برای بازگشت).';

      default:
        this.userState.set(phone, 'MAIN_MENU');
        return this.getMainMenu();
    }
  }

  private getMainMenu(): string {
    return `🤖 *ربات هوشمند*\n\n1️⃣ محصولات\n2️⃣ تماس با ما\n\n(گزینه مورد نظر را بفرستید)`;
  }
}