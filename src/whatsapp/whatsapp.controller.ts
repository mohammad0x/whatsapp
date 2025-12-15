import { Body, Controller,UseInterceptors,UploadedFile, Get, Param, Post, UseGuards, Request } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { ApiBearerAuth, ApiConsumes,ApiBody,ApiOperation, ApiTags, ApiProperty } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FileInterceptor } from '@nestjs/platform-express'; 

class StartSessionDto {
  // برای استارت، کاربر می‌تواند نام دلخواه بدهد یا ندهد
  // اگر ندهد، ما اتوماتیک یک نام برایش می‌سازیم
  @ApiProperty({ description: 'نام دلخواه نشست (اختیاری)', required: false })
  sessionId?: string;
}

class SendTextDto {
  // ❌ sessionId حذف شد
  @ApiProperty({ description: 'شماره موبایل گیرنده' })
  phone: string;
  @ApiProperty({ description: 'متن پیام' })
  message: string;
}


// DTO مخصوص آپلود
class UploadImageDto {
  @ApiProperty({ description: 'شماره موبایل گیرنده' })
  phone: string;

  @ApiProperty({ description: 'توضیحات عکس (اختیاری)', required: false })
  caption: string;

  // نکته: فایل اینجا تعریف نمی‌شود چون در Body نیست، بلکه در Form-Data است.
  // اما برای Swagger باید آن را دستی تعریف کنیم (در کنترلر).
}

class SendFileDto {
  @ApiProperty({ description: 'شماره موبایل گیرنده' })
  phone: string;
  @ApiProperty({ description: 'لینک فایل' })
  fileUrl: string;
  @ApiProperty({ description: 'نام فایل' })
  fileName: string;
  @ApiProperty({ description: 'توضیحات (اختیاری)', required: false })
  caption: string;
}

class SendBulkDto {
  @ApiProperty({ description: 'لیست شماره‌ها', type: [String] })
  phones: string[];
  @ApiProperty({ description: 'پیام همگانی' })
  message: string;
  @ApiProperty({ description: 'تاخیر (ثانیه)', default: 5 })
  delay: number;
}

class SetWebhookDto {
  @ApiProperty({ description: 'آدرس سرور شما' })
  url: string;
}

// ==========================================
// 2️⃣ کنترلر اصلی
// ==========================================

@ApiTags('WhatsApp')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  // 🚀 شروع نشست (اگر کاربر نام نداد، session_USERID ساخته می‌شود)
  @Post('start')
  @ApiOperation({ summary: 'ساخت ربات برای کاربر جاری' })
  async startSession(@Body() body: StartSessionDto, @Request() req) {
    const userId = req.user.userId;
    // اگر کاربر اسمی نفرستاد، اسم سشن را می‌گذاریم: session_USERID
    const sessionId = body.sessionId || `session_${userId}`;
    
    return this.whatsappService.createSession(sessionId, userId);
  }

  // 📊 وضعیت (اتوماتیک)
// 👇 اصلاح شده: اضافه کردن :sessionId به آدرس
  @Get('status/:sessionId')
  @ApiOperation({ summary: 'بررسی وضعیت و دریافت QR' })
  async getStatus(@Param('sessionId') sessionId: string, @Request() req) {
    // به جای پیدا کردن اتوماتیک، وضعیتِ همان نشستی که HTML خواسته را برمی‌گردانیم
    return this.whatsappService.getSessionStatus(sessionId, req.user.userId);
  }
  // 📩 ارسال متن
  @Post('send-text')
  @ApiOperation({ summary: 'ارسال پیام متنی' })
  async sendMessage(@Body() body: SendTextDto, @Request() req) {
    const sessionId = await this.whatsappService.getSessionIdByUser(req.user.userId);
    return this.whatsappService.sendTextMessage(
        sessionId, 
        body.phone, 
        body.message, 
        req.user.userId
    );
  }

  // 📷 ارسال عکس
  // 📤 متد جدید: آپلود مستقیم عکس
  @Post('upload-image')
  @UseInterceptors(FileInterceptor('file')) // نام فیلد فایل باید 'file' باشد
  @ApiConsumes('multipart/form-data') // به Swagger می‌گوید این یک آپلود فایل است
  @ApiOperation({ summary: 'آپلود مستقیم عکس از کامپیوتر' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        phone: { type: 'string' },
        caption: { type: 'string' },
        file: { // تعریف دکمه فایل در Swagger
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  async uploadImage(
    @Body() body: UploadImageDto,
    @UploadedFile() file: Express.Multer.File, // دریافت فایل
    @Request() req
  ) {
    // چک کردن اینکه فایلی آپلود شده یا نه
    if (!file) throw new Error('❌ لطفا یک فایل انتخاب کنید!');

    const sessionId = await this.whatsappService.getSessionIdByUser(req.user.userId);
    
    return this.whatsappService.sendImageBuffer(
        sessionId,
        body.phone,
        file.buffer, // ارسال بافر فایل به سرویس
        body.caption || '',
        req.user.userId
    );
  }

  // 📄 ارسال فایل
  @Post('send-file')
  @ApiOperation({ summary: 'ارسال فایل' })
  async sendFile(@Body() body: SendFileDto, @Request() req) {
    const sessionId = await this.whatsappService.getSessionIdByUser(req.user.userId);
    return this.whatsappService.sendDocumentMessage(
        sessionId, 
        body.phone, 
        body.fileUrl, 
        body.fileName, 
        body.caption || '', 
        req.user.userId
    );
  }

  // 📢 ارسال انبوه
  @Post('send-bulk')
  @ApiOperation({ summary: 'ارسال پیام همزمان' })
  async sendBulk(@Body() body: SendBulkDto, @Request() req) {
    const sessionId = await this.whatsappService.getSessionIdByUser(req.user.userId);
    const results: any[] = []; 
    const delayTime = (body.delay || 5) * 1000;

    for (const phone of body.phones) {
        try {
            await this.whatsappService.sendTextMessage(sessionId, phone, body.message, req.user.userId);
            results.push({ phone, status: 'sent' });
            if (body.phones.length > 1) {
                await new Promise(resolve => setTimeout(resolve, delayTime));
            }
        } catch (error) {
            results.push({ phone, status: 'failed', error: error.message });
        }
    }
    return { summary: 'Bulk sending completed', results };
  }

  // 🔗 تنظیم وب‌هوک
  @Post('webhook')
  @ApiOperation({ summary: 'تنظیم وب‌هوک' })
  async setWebhook(@Body() body: SetWebhookDto, @Request() req) {
    const sessionId = await this.whatsappService.getSessionIdByUser(req.user.userId);
    return this.whatsappService.setWebhook(sessionId, body.url, req.user.userId);
  }
  
  // 👥 لیست مخاطبین
  @Get('contacts')
  @ApiOperation({ summary: 'دریافت لیست مخاطبین من' })
  async getContacts(@Request() req) {
    const sessionId = await this.whatsappService.getSessionIdByUser(req.user.userId);
    return this.whatsappService.getContacts(sessionId);
  }

  // 💬 تاریخچه چت
  @Get('history/:phone')
  @ApiOperation({ summary: 'دریافت چت با یک شماره خاص' })
  async getChatHistory(@Param('phone') phone: string, @Request() req) {
    const sessionId = await this.whatsappService.getSessionIdByUser(req.user.userId);
    return this.whatsappService.getChatHistory(sessionId, phone);
  }
}