import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SuperAdminService {
  constructor(private prisma: PrismaService) {}

  // ۱. دریافت لیست تمام ادمین‌ها (صاحبان کسب و کار)
  async getAllUsers() {
    return this.prisma.user.findMany({
      where: { role: 'ADMIN' }, // ایجنت‌ها و خود سوپر ادمین را در لیست نیاور
      select: {
        id: true,
        email: true,
        name: true,
        plan: true,
        isActive: true,
        subscriptionEnd: true,
        createdAt: true,
        _count: { select: { agents: true } } // تعداد کارمندان هر شرکت
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  // ۲. فعال‌سازی یا تمدید اشتراک
  async activateSubscription(userId: number, days: number, plan: string = 'PRO') {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('کاربر یافت نشد');

    const expireDate = new Date();
    expireDate.setDate(expireDate.getDate() + days);

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        isActive: true,
        plan: plan, // مثلا 'PRO' یا 'PREMIUM'
        subscriptionEnd: expireDate,
      },
    });
  }

  // ۳. لغو موقت یا مسدود کردن کامل یک شرکت
  async deactivateAccount(userId: number) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        isActive: false, // دسترسی کاربر به طور کامل قطع می‌شود
      },
    });
  }

  // ۴. تغییر پلن کاربر به حالت رایگان (بدون محدودیت زمانی اما با امکانات محدود)
  async setFreePlan(userId: number) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        isActive: true,
        plan: 'FREE',
        subscriptionEnd: null, // پلن رایگان انقضا ندارد
      },
    });
  }
}