import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user; 

    if (!user) return false;

    // مدیر کل نیازی به چک کردن اشتراک ندارد
    if (user.role === 'SUPER_ADMIN') return true;

    // پیدا کردن آیدی رئیس (برای زمانی که یک ایجنت لاگین کرده باشد)
    let targetUserId = user.userId;
    if (user.role === 'AGENT') {
      const agent = await this.prisma.agent.findFirst({ where: { email: user.email } });
      if (agent) targetUserId = agent.userId;
    }

    // گرفتن اطلاعات حساب اصلی از دیتابیس
    const owner = await this.prisma.user.findUnique({ where: { id: targetUserId } });

    if (!owner) throw new ForbiddenException('حساب کاربری یافت نشد.');

    // ۱. بررسی وضعیت کلی اکانت
    if (!owner.isActive) {
      throw new ForbiddenException('اکانت شرکت شما مسدود شده است. لطفاً با پشتیبانی تماس بگیرید.');
    }

    // ۲. بررسی تاریخ انقضا (اگر پلن پولی باشد)
    if (owner.plan !== 'FREE' && owner.subscriptionEnd) {
      const now = new Date();
      if (now > owner.subscriptionEnd) {
        // تغییر اتوماتیک پلن کاربر به حالت FREE پس از انقضا
        await this.prisma.user.update({
          where: { id: owner.id },
          data: { plan: 'FREE' }
        });
        
        throw new ForbiddenException('زمان اشتراک شما به پایان رسیده است. لطفاً آن را تمدید کنید.');
      }
    }

    // ۳. ارسال پلن کاربر به کنترلر بعدی (تا مثلاً اگر FREE بود اجازه ارسال پیام گروهی ندهید)
    request.userPlan = owner.plan;

    return true;
  }
}