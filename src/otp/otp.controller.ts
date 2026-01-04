import { Controller, Post, Body, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiProperty } from '@nestjs/swagger';
import { OtpService } from './otp.service';

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
export class OtpController {
  constructor(private readonly otpService: OtpService) {}

  @Post('send')
  @ApiOperation({ summary: 'ارسال کد تایید (OTP) در واتساپ' })
  async sendOtp(@Body() body: SendOtpDto) {
    return this.otpService.sendOtp(body.sessionId, body.phone, body.code, body.brand);
  }
}