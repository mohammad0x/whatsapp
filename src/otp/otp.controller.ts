import { Controller, Post, Body, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiProperty, ApiBearerAuth } from '@nestjs/swagger';
import { OtpService } from './otp.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard'; // 👈 گارد احراز هویت را ایمپورت کنید

// DTO: مدل داده‌های ورودی
class SendOtpDto {
  @ApiProperty({ example: '09123456789', description: 'شماره موبایل گیرنده' })
  phone: string;

  @ApiProperty({ example: '12345', description: 'کد تایید' })
  code: string;
  
  @ApiProperty({ example: 'فروشگاه من', description: 'نام برند (اختیاری)', required: false })
  brand?: string;
  
  @ApiProperty({ example: 'session_1', description: 'شناسه سشن ربات' })
  sessionId: string;
}

@ApiTags('OTP Service')
@Controller('otp')
@ApiBearerAuth() // 👈 دکمه قفل را در Swagger اضافه می‌کند
@UseGuards(JwtAuthGuard) // 🔒 کل این کنترلر محافظت می‌شود (فقط کاربران لاگین شده)
export class OtpController {
  constructor(private readonly otpService: OtpService) {}

  @Post('send')
  @ApiOperation({ summary: 'ارسال کد تایید (OTP) در واتساپ' })
  async sendOtp(@Body() body: SendOtpDto, @Request() req) { // 👈 دریافت req
    
    // استخراج User ID از توکن کاربر لاگین شده
    const userId = req.user.userId;

    // ارسال userId به سرویس برای بررسی دسترسی
    return this.otpService.sendOtp(body.sessionId, body.phone, body.code, userId, body.brand);
  }
}