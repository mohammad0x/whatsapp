import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { AppService } from './app.service';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Dashboard')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('dashboard/stats')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'دریافت آمار کلی داشبورد' })
  async getStats(@Request() req) {
    // ✅ پاس دادن کل شیء کاربر (req.user) به جای فقط آیدی، تا بتوانیم ارتباط را پیدا کنیم
    return this.appService.getDashboardStats(req.user);
  }
}