import { Body, Controller, Post ,UseGuards } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { ApiProperty, ApiTags,ApiSecurity, ApiOperation } from '@nestjs/swagger';
import { ApiKeyGuard } from '../auth/api-key.guard'; // ایمپورت گارد جدید

// --- تعریف ساختار داده‌ها (DTOs) ---
// این کلاس‌ها باعث می‌شوند در Swagger فیلدها نمایش داده شوند

class StartSessionDto {
  @ApiProperty({ example: 'user_1', description: 'نام کاربری یا شناسه یکتا' })
  sessionId: string;
}

class SendTextDto {
  @ApiProperty({ example: 'user_1' })
  sessionId: string;

  @ApiProperty({ example: '989365052887', description: 'شماره موبایل بدون +' })
  phone: string;

  @ApiProperty({ example: 'سلام، این یک تست است' })
  message: string;
}

class SendImageDto {
  @ApiProperty({ example: 'user_1' })
  sessionId: string;

  @ApiProperty({ example: '989365052887' })
  phone: string;

  @ApiProperty({ example: 'https://via.placeholder.com/150', description: 'لینک عکس یا مسیر فایل لوکال' })
  imageUrl: string;

  @ApiProperty({ example: 'توضیحات عکس' })
  caption: string;

  @ApiProperty({ example: false, required: false, description: 'آیا فایل روی سرور است؟' })
  local?: boolean;
}

// --- کنترلر اصلی ---
@ApiTags('WhatsApp') // دسته‌بندی در داکیومنت
@Controller('whatsapp')
@ApiSecurity('api-key') // ۱. اضافه کردن قفل به داکیومنت سواگر
@UseGuards(ApiKeyGuard) // ۲. فعال کردن نگهبان برای کل این کنترلر
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  @Post('start')
  @ApiOperation({ summary: 'ایجاد نشست جدید / دریافت QR Code' })
  async startSession(@Body() body: StartSessionDto) {
    return this.whatsappService.createSession(body.sessionId);
  }

  @Post('send')
  @ApiOperation({ summary: 'ارسال پیام متنی' })
  async sendMessage(@Body() body: SendTextDto) {
    return this.whatsappService.sendTextMessage(body.sessionId, body.phone, body.message);
  }

  @Post('send-image')
  @ApiOperation({ summary: 'ارسال عکس (لینک یا فایل)' })
  async sendImage(@Body() body: SendImageDto) {
    return this.whatsappService.sendImageMessage(
        body.sessionId, 
        body.phone, 
        body.imageUrl, 
        body.caption, 
        body.local || false
    );
  }
}