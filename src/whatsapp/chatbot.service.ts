import { Injectable } from '@nestjs/common';

@Injectable()
export class ChatbotService {
  // حافظه موقت وضعیت کاربران
  private userState = new Map<string, string>();

  getResponse(phone: string, message: string): string | null {
    if (!message) return null;
    
    // ۱. نرمال‌سازی متن (حذف فاصله و تبدیل به حروف کوچک برای مقایسه راحت‌تر)
    // اعداد را هم فارسی به انگلیسی تبدیل کنید عالی می‌شود، ولی فعلا همین کافیست
    const text = message.trim().toLowerCase(); 
    
    // --- ۲. دستورات عمومی (همیشه اولویت دارند) ---
    // این دستورات در هر مرحله‌ای باشند کار می‌کنند

    if (text === '0' || text === 'بازگشت' || text === 'منو') {
        this.userState.set(phone, 'WAITING_FOR_OPTION'); // ریست به منوی اصلی
        return this.getMainMenu();
    }

    // منطق خاص شما (با سانسور 😂)
    if (text.includes('کونی')) return 'مودب باش! 😐'; 
    
    if (text.includes('قیمت')) return '💰 قیمت اشتراک ماهیانه ما ۱۰۰ هزار تومان است.';
    
    if (text.includes('ساعت')) return `⏰ ساعت فعلی سرور: ${new Date().toLocaleTimeString('fa-IR')}`;

    // سلام و احوال‌پرسی (حالا اگر کاربر جدید هم باشد، اول این را می‌بیند)
    if (['سلام', 'slm', 'hi', 'hello', 'درود'].some(w => text.includes(w))) {
         // اگر سلام کرد، وضعیتش را می‌بریم روی منوی اصلی ولی جواب سلام هم می‌دهیم
         this.userState.set(phone, 'WAITING_FOR_OPTION');
         return 'سلام دوست عزیز! 👋\nبه ربات ما خوش آمدید.\n\n' + this.getMainMenu();
    }

    // --- ۳. سیستم منوی هوشمند (State Machine) ---
    // اگر کاربر وضعیت نداشت، پیش‌فرض START است
    const currentState = this.userState.get(phone) || 'START';

    switch (currentState) {
      case 'START':
        // اولین برخورد کاربر (که سلام نکرده باشد)
        this.userState.set(phone, 'WAITING_FOR_OPTION');
        return this.getMainMenu();

      case 'MAIN_MENU': // اگر قبلا ست شده باشد
      case 'WAITING_FOR_OPTION':
        if (text === '1') {
             this.userState.set(phone, 'PRODUCT_MENU');
             return '🛍️ *منوی محصولات:*\n۱. آیفون 📱\n۲. سامسونگ 📱\n\n0. بازگشت به منوی اصلی';
        }
        if (text === '2') {
             return '📞 شماره پشتیبانی: 021-12345678\n(برای بازگشت عدد 0 را بفرستید)';
        }
        return '❌ گزینه اشتباه است.\nلطفاً عدد ۱ یا ۲ را بفرستید (یا "سلام" کنید).';

      case 'PRODUCT_MENU':
        if (text === '1') return '✅ آیفون ۱۳ پرو: ۳۵ میلیون تومان.\n(سفارش دیگری دارید؟)';
        if (text === '2') return '✅ سامسونگ S24 اولترا: ۵۰ میلیون تومان.\n(سفارش دیگری دارید؟)';
        return '❌ عدد ۱ یا ۲ را بزنید (یا ۰ برای بازگشت).';

      default:
        // اگر وضعیت نامشخصی پیش آمد، ریست کن
        this.userState.set(phone, 'WAITING_FOR_OPTION');
        return this.getMainMenu();
    }
  }

  private getMainMenu(): string {
    return `🤖 *منوی اصلی*\n\n1️⃣ محصولات\n2️⃣ تماس با ما\n\n👇 گزینه مورد نظر را بفرستید:`;
  }
}