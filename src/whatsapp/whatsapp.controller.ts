import { Body, Controller,Get,Param, Post, UseGuards, Request } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiProperty, ApiSecurity } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

// --- DTOs ---
class StartSessionDto {
  @ApiProperty({ example: 'session_1' })
  sessionId: string;
}

class SetWebhookDto {
  @ApiProperty({ example: 'session_1' })
  sessionId: string;
  @ApiProperty({ example: 'http://localhost:4000/webhook' })
  url: string;
}

class SendTextDto {
  @ApiProperty({ example: 'session_1' })
  sessionId: string;
  @ApiProperty({ example: '989915130152' })
  phone: string;
  @ApiProperty({ example: 'سلام' })
  message: string;
}

class SendImageDto {
  @ApiProperty({ example: 'session_1' })
  sessionId: string;
  @ApiProperty({ example: '989915130152' })
  phone: string;
  @ApiProperty({ example: './test.jpeg' })
  imageUrl: string;
  @ApiProperty({ example: 'توضیحات عکس' })
  caption: string;
  @ApiProperty({ example: true, required: false })
  local?: boolean;
}

@ApiTags('WhatsApp')
@ApiBearerAuth() // نمایش دکمه توکن در سواگر
@UseGuards(JwtAuthGuard) // فعال کردن قفل امنیتی برای همه متدها
@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  @Post('start')
  @ApiOperation({ summary: 'ایجاد نشست جدید' })
  async startSession(@Body() body: StartSessionDto, @Request() req) {
    // ارسال userId از توکن به سرویس
    return this.whatsappService.createSession(body.sessionId, req.user.userId);
  }

  @Post('webhook')
  @ApiOperation({ summary: 'تنظیم آدرس وب‌هوک برای دریافت پیام‌ها' })
  async setWebhook(@Body() body: SetWebhookDto, @Request() req) {
    return this.whatsappService.setWebhook(body.sessionId, body.url, req.user.userId);
  }

  @Get('status/:sessionId')
  @ApiOperation({ summary: 'دریافت وضعیت اتصال و عکس QR' })
  async getStatus(@Param('sessionId') sessionId: string, @Request() req) {
    return this.whatsappService.getSessionStatus(sessionId, req.user.userId);
  }

  @Post('send')
  @ApiOperation({ summary: 'ارسال پیام متنی' })
  async sendMessage(@Body() body: SendTextDto, @Request() req) {
    return this.whatsappService.sendTextMessage(body.sessionId, body.phone, body.message, req.user.userId);
  }

  @Post('send-image')
  @ApiOperation({ summary: 'ارسال پیام تصویری' })
  async sendImage(@Body() body: SendImageDto, @Request() req) {
    return this.whatsappService.sendImageMessage(
        body.sessionId, 
        body.phone, 
        body.imageUrl, 
        body.caption, 
        body.local || false,
        req.user.userId // ارسال شناسه کاربر
    );
  }
  
}