import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { SuperAdminService } from './super-admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SuperAdminGuard } from '../auth/super-admin.guard';

@Controller('crm/super-admin')
// 🛡️ استفاده از ترکیب توکن‌خوان و گارد اختصاصی مدیر کل
@UseGuards(JwtAuthGuard, SuperAdminGuard) 
export class SuperAdminController {
  constructor(private readonly superAdminService: SuperAdminService) {}

  @Get('users')
  getAllUsers() {
    return this.superAdminService.getAllUsers();
  }

  // برای شارژ ۳۰ روزه: { "days": 30, "plan": "PRO" }
  @Post('users/:id/activate')
  activateUser(@Param('id') id: string, @Body() body: { days: number, plan: string }) {
    return this.superAdminService.activateSubscription(+id, body.days || 30, body.plan || 'PRO');
  }

  @Post('users/:id/deactivate')
  deactivateUser(@Param('id') id: string) {
    return this.superAdminService.deactivateAccount(+id);
  }

  @Post('users/:id/free-plan')
  setFreePlan(@Param('id') id: string) {
    return this.superAdminService.setFreePlan(+id);
  }
}