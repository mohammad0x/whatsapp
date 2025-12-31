// src/auth/roles.guard.ts
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // 1. دریافت نقش‌های مورد نیاز متد (مثلا ['ADMIN'])
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // اگر هیچ نقشی برای متد تعریف نشده بود، دسترسی باز است
    if (!requiredRoles) {
      return true;
    }

    // 2. دریافت اطلاعات کاربر از ریکوئست
    const { user } = context.switchToHttp().getRequest();

    // 3. بررسی اینکه آیا کاربر نقش لازم را دارد؟
    if (!user || !user.role || !requiredRoles.includes(user.role)) {
       throw new ForbiddenException('شما دسترسی لازم برای انجام این عملیات را ندارید.');
    }
    
    return true;
  }
}