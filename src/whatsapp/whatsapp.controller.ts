import { 
  Body, 
  Controller, 
  UseInterceptors, 
  UploadedFile, 
  Get, 
  Param, 
  Post, 
  UseGuards, 
  Request, 
  BadRequestException, 
  Delete 
} from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { QueueService } from '../queue/queue.service'; 
import { ApiBearerAuth, ApiConsumes, ApiBody, ApiOperation, ApiTags, ApiProperty } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FileInterceptor } from '@nestjs/platform-express'; 
import { PrismaService } from '../prisma/prisma.service';

// --- DTOs ---

class StartSessionDto {}

class SendTextDto {
  @ApiProperty({ description: 'شماره موبایل گیرنده (مثال: 98912...)' })
  phone: string;
  @ApiProperty({ description: 'متن پیام' })
  message: string;
}

class UploadImageDto {
  @ApiProperty({ description: 'شماره موبایل گیرنده' })
  phone: string;
  @ApiProperty({ description: 'توضیحات عکس (اختیاری)', required: false })
  caption: string;
}

class SendFileDto {
  @ApiProperty({ description: 'شماره موبایل گیرنده' })
  phone: string;
  @ApiProperty({ description: 'لینک دانلود فایل' })
  fileUrl: string;
  @ApiProperty({ description: 'نام فایل' })
  fileName: string;
  @ApiProperty({ description: 'توضیحات', required: false })
  caption: string;
}

class SendBulkDto {
  @ApiProperty({ description: 'لیست شماره‌ها', type: [String], example: ['989120000000', '989350000000'] })
  phones: string[];
  @ApiProperty({ description: 'متن پیام همگانی' })
  message: string;
  @ApiProperty({ description: 'لینک تصویر (اختیاری)', required: false })
  mediaUrl?: string;
}



// کلاسی برای تعریف ورودی‌های تست وب‌هوک
 export class TestWebhookDto {
  @ApiProperty({ required: false })
  url?: string;

  // 👇 اضافه کردن نوع تست
  @ApiProperty({ 
    required: false, 
    enum: ['text', 'image', 'status'],
    description: 'نوع سناریوی تست',
    example: 'text'
  })
  type?: 'text' | 'image' | 'status';
}

// کلاسی برای تنظیم وب‌هوک (برای متد setWebhook هم بهتر است این کار را بکنید)
export class SetWebhookDto {
  @ApiProperty({ 
    required: true, 
    description: 'آدرس کامل وب‌هوک',
    example: 'https://example.com/api/webhook' 
  })
  url: string;
}

class AddKeywordDto {
  @ApiProperty({ description: 'کلمه کلیدی' })
  trigger: string;
  @ApiProperty({ description: 'پاسخ ربات' })
  response: string;
}

// --- Controller Logic ---

@ApiTags('WhatsApp')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('whatsapp')
export class WhatsappController {
  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService
  ) {}

  private getSessionId(req: any): string {
    return `session_${req.user.userId}`;
  }

  // ==========================================
  // 1️⃣ مدیریت اتصال
  // ==========================================

  @Post('start')
  @ApiOperation({ summary: 'روشن کردن ربات' })
  async startSession(@Body() body: StartSessionDto, @Request() req) {
    const userId = req.user.userId;
    const sessionId = this.getSessionId(req);
    return this.whatsappService.createSession(sessionId, userId);
  }

  @Get('status')
  @ApiOperation({ summary: 'وضعیت اتصال و QR کد' })
  async getStatus(@Request() req) {
    const userId = req.user.userId;
    const sessionId = this.getSessionId(req);
    return this.whatsappService.getSessionStatus(sessionId, userId);
  }

  @Delete('session')
  async disconnect(@Request() req) {
    const sessionId = this.getSessionId(req);
    await this.whatsappService.disconnect(sessionId); // 👈 آیدی پاس داده شد
    return { status: 'DISCONNECTED', message: 'Session removed' };
}

  // ==========================================
  // 2️⃣ ارسال پیام
  // ==========================================

  @Post('send/text') 
  @ApiOperation({ summary: 'ارسال پیام متنی فوری' })
  async sendMessage(@Body() body: SendTextDto, @Request() req) {
    const sessionId = this.getSessionId(req);
    return this.whatsappService.sendTextMessage(
        sessionId, 
        body.phone, 
        body.message, 
        req.user.userId
    );
  }

  @Post('upload-image')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'ارسال عکس' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        phone: { type: 'string' },
        caption: { type: 'string' },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  async uploadImage(
    @Body() body: UploadImageDto,
    @UploadedFile() file: Express.Multer.File,
    @Request() req
  ) {
    if (!file) throw new BadRequestException('❌ لطفا فایل انتخاب کنید');
    const sessionId = this.getSessionId(req);
    
    return this.whatsappService.sendImageBuffer(
        sessionId,
        body.phone,
        file.buffer,
        body.caption || '',
        req.user.userId
    );
  }

  @Post('send-file')
  @ApiOperation({ summary: 'ارسال فایل با لینک' })
  async sendFile(@Body() body: SendFileDto, @Request() req) {
    const sessionId = this.getSessionId(req);
    return this.whatsappService.sendDocumentMessage(
        sessionId, 
        body.phone, 
        body.fileUrl, 
        body.fileName, 
        body.caption || '', 
        req.user.userId
    );
  }

  // ==========================================
  // 3️⃣ ارسال انبوه
  // ==========================================

  @Post('send-bulk')
  @ApiOperation({ summary: 'ارسال انبوه هوشمند' })
  async sendBulk(@Body() body: SendBulkDto, @Request() req) {
    const sessionId = this.getSessionId(req);
    
    const result = await this.queueService.addBulkCampaign(
        req.user.userId,
        sessionId,
        body.phones,
        body.message,
        body.mediaUrl
    );

    return { 
        success: true,
        message: 'کمپین ارسال انبوه در صف قرار گرفت.',
        queueDetails: result 
    };
  }

  // ==========================================
  // 4️⃣ اینباکس
  // ==========================================

  @Get('conversations')
  @ApiOperation({ summary: 'دریافت لیست چت‌ها' })
  async getConversations(@Request() req) {
    const sessionId = this.getSessionId(req);
    return this.whatsappService.getConversations(sessionId);
  }

  @Get('messages/:id') 
  @ApiOperation({ summary: 'دریافت پیام‌های چت' })
  async getConversationMessages(@Param('id') id: string, @Request() req) {
    return this.whatsappService.getConversationMessages(Number(id));
  }

  // ==========================================
  // 5️⃣ تنظیمات
  // ==========================================

// ... داخل کلاس WhatsappController ...

  // ۱. تنظیم وب‌هوک
  @Post('webhook')
  @ApiOperation({ summary: 'تنظیم آدرس وب‌هوک' })
  // 👇 استفاده از DTO
  async setWebhook(@Request() req, @Body() body: SetWebhookDto) {
    const userId = req.user.userId;
    const sessionId = `session_${userId}`;
    return this.whatsappService.setWebhook(sessionId, body.url, userId);
  }

  // ... متدهای GET و DELETE ...

  // ۳. تست وب‌هوک
  @Post('webhook/test')
  async testWebhook(@Request() req, @Body() body: TestWebhookDto) {
    const userId = req.user.userId;
    const sessionId = `session_${userId}`;
    // ارسال نوع تست به سرویس
    return this.whatsappService.testWebhook(sessionId, body.url, body.type);
  }

  // ۲. دریافت آدرس فعلی (برای نمایش در فرانت)
  @Get('webhook')
  async getWebhook(@Request() req) {
    const userId = req.user.userId;
    const sessionId = `session_${userId}`;
    return this.whatsappService.getWebhook(sessionId);
  }


  // ۴. حذف وب‌هوک
  @Delete('webhook')
  async deleteWebhook(@Request() req) {
    const userId = req.user.userId;
    const sessionId = `session_${userId}`;
    return this.whatsappService.deleteWebhook(sessionId);
  }

  @Post('keywords')
  @ApiOperation({ summary: 'افزودن کلمه کلیدی' })
  async addKeyword(@Body() body: AddKeywordDto, @Request() req) {
    return this.prisma.keyword.create({
      data: {
        trigger: body.trigger.toLowerCase().trim(),
        response: body.response,
        userId: req.user.userId,
      },
    });
  }

  @Get('keywords')
  async getKeywords(@Request() req) {
    return this.prisma.keyword.findMany({
      where: { userId: req.user.userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Delete('keywords/:id')
  async deleteKeyword(@Param('id') id: string, @Request() req) {
    return this.prisma.keyword.delete({
      where: { 
        id: Number(id),
        userId: req.user.userId 
      },
    });
  }
}