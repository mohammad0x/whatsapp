import { Injectable, CanActivate, ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const tokenPayload = request.user; // اطلاعاتی که JwtAuthGuard استخراج کرده است

    if (!tokenPayload) {
      throw new UnauthorizedException('توکن یافت نشد. لطفاً وارد سیستم شوید.');
    }

    // ۱. استخراج امن آیدی از توکن (بدون ایجاد ارور در پریزما)
    // معمولاً توکن‌ها آیدی را در یکی از این سه فیلد ذخیره می‌کنند
    const userId = Number(tokenPayload.sub || tokenPayload.userId || tokenPayload.id);

    if (!userId || isNaN(userId)) {
      throw new UnauthorizedException('ساختار توکن نامعتبر است (آیدی یافت نشد).');
    }

    // ۲. جستجوی مستقیم و بسیار ایمن فقط با استفاده از ID
    const dbUser = await this.prisma.user.findUnique({
      where: { id: userId }
    });

    // ۳. بررسی نهاییِ نقش مستقیماً از روی دیتابیس
    if (!dbUser || dbUser.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('دسترسی مسدود شد! شما اجازه ورود به پنل مدیر کل را ندارید.');
    }

    return true;
  }
}