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
import { IsOptional, IsString, IsEnum, IsUrl } from 'class-validator'; 

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

export class TestWebhookDto {
  @ApiProperty({ required: false, description: 'آدرس وب‌هوک برای تست', example: 'https://webhook.site/...' })
  @IsOptional()
  @IsUrl()
  url?: string;

  @ApiProperty({ required: false, enum: ['text', 'image', 'status'], description: 'نوع سناریوی تست', example: 'text' })
  @IsOptional()
  @IsEnum(['text', 'image', 'status'])
  type?: 'text' | 'image' | 'status';

  @ApiProperty({ required: false, description: 'متن پیام تست اختصاصی', example: 'سلام تست' })
  @IsOptional()
  @IsString()
  text?: string;
}

export class SetWebhookDto {
  @ApiProperty({ required: true, description: 'آدرس کامل وب‌هوک', example: 'https://example.com/api/webhook' })
  url: string;
}

class AddKeywordDto {
  @ApiProperty({ description: 'کلمه کلیدی', example: 'قیمت' })
  trigger: string;
  @ApiProperty({ description: 'پاسخ ربات', example: 'قیمت محصول ۱۰۰ تومان است' })
  response: string;
}

class ToggleAiDto {
  @ApiProperty({ description: 'وضعیت هوش مصنوعی', example: true })
  enabled: boolean;
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
    return 'session_1'; 
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
  @ApiOperation({ summary: 'قطع اتصال ربات' })
  async disconnect(@Request() req) {
    const sessionId = this.getSessionId(req);
    await this.whatsappService.disconnect(sessionId);
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
  async uploadImage(@Body() body: UploadImageDto, @UploadedFile() file: Express.Multer.File, @Request() req) {
    if (!file) throw new BadRequestException('❌ لطفا فایل انتخاب کنید');
    const sessionId = this.getSessionId(req);
    return this.whatsappService.sendImageBuffer(sessionId, body.phone, file.buffer, body.caption || '', req.user.userId);
  }

  @Post('send-file')
  @ApiOperation({ summary: 'ارسال فایل با لینک' })
  async sendFile(@Body() body: SendFileDto, @Request() req) {
    const sessionId = this.getSessionId(req);
    return this.whatsappService.sendDocumentMessage(sessionId, body.phone, body.fileUrl, body.fileName, body.caption || '', req.user.userId);
  }

  // ==========================================
  // 3️⃣ ارسال انبوه
  // ==========================================

  @Post('send-bulk')
  @ApiOperation({ summary: 'ارسال انبوه هوشمند' })
  async sendBulk(@Body() body: SendBulkDto, @Request() req) {
    const sessionId = this.getSessionId(req);
    const result = await this.queueService.addBulkCampaign(req.user.userId, sessionId, body.phones, body.message, body.mediaUrl);
    return { success: true, message: 'کمپین ارسال انبوه در صف قرار گرفت.', queueDetails: result };
  }

  // ==========================================
  // 4️⃣ اینباکس
  // ==========================================

  @Get('conversations')
  @ApiOperation({ summary: 'دریافت لیست چت‌ها (فیلتر شده برای ایجنت)' })
  async getConversations(@Request() req) {
    const sessionId = this.getSessionId(req);
    // 👇 تغییر: ارسال req.user به سرویس
    return this.whatsappService.getConversations(sessionId, req.user);
  }

  @Get('messages/:id') 
  @ApiOperation({ summary: 'دریافت پیام‌های چت' })
  async getConversationMessages(@Param('id') id: string, @Request() req) {
    return this.whatsappService.getConversationMessages(Number(id));
  }

  // ==========================================
  // 5️⃣ وب‌هوک (Webhook)
  // ==========================================

  @Post('webhook')
  @ApiOperation({ summary: 'تنظیم آدرس وب‌هوک' })
  async setWebhook(@Request() req, @Body() body: SetWebhookDto) {
    const userId = req.user.userId;
    const sessionId = this.getSessionId(req);
    return this.whatsappService.setWebhook(sessionId, body.url, userId);
  }

  @Post('webhook/test')
  @ApiOperation({ summary: 'تست وب‌هوک' })
  async testWebhook(@Request() req, @Body() body: TestWebhookDto) {
    const sessionId = this.getSessionId(req);
    return this.whatsappService.testWebhook(sessionId, body.url, body.type, body.text);
  }

  @Get('webhook')
  @ApiOperation({ summary: 'دریافت آدرس وب‌هوک فعلی' })
  async getWebhook(@Request() req) {
    const sessionId = this.getSessionId(req);
    return this.whatsappService.getWebhook(sessionId);
  }

  @Delete('webhook')
  @ApiOperation({ summary: 'حذف وب‌هوک' })
  async deleteWebhook(@Request() req) {
    const sessionId = this.getSessionId(req);
    return this.whatsappService.deleteWebhook(sessionId);
  }

  // ==========================================
  // 6️⃣ کلمات کلیدی (Keywords)
  // ==========================================

  @Post('keywords')
  @ApiOperation({ summary: 'افزودن یا آپدیت کلمه کلیدی' })
  async addKeyword(@Body() body: AddKeywordDto, @Request() req) {
    const userId = req.user.userId;
    const cleanTrigger = body.trigger.trim().toLowerCase();

    // اگر کلمه تکراری بود، آپدیت کن (به جای خطا دادن)
    const existing = await this.prisma.keyword.findFirst({
        where: { userId, trigger: cleanTrigger }
    });

    if (existing) {
        return this.prisma.keyword.update({
            where: { id: existing.id },
            data: { response: body.response }
        });
    }

    return this.prisma.keyword.create({
      data: {
        trigger: cleanTrigger,
        response: body.response,
        userId: userId,
      },
    });
  }

  @Get('keywords')
  @ApiOperation({ summary: 'لیست کلمات کلیدی' })
  async getKeywords(@Request() req) {
    return this.prisma.keyword.findMany({
      where: { userId: req.user.userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Delete('keywords/:id')
  @ApiOperation({ summary: 'حذف کلمه کلیدی' })
  async deleteKeyword(@Param('id') id: string, @Request() req) {
    // استفاده از deleteMany برای امنیت (مطمئن شویم مال خود کاربر است)
    const result = await this.prisma.keyword.deleteMany({
      where: { 
        id: Number(id),
        userId: req.user.userId 
      },
    });
    
    if (result.count === 0) throw new BadRequestException('کلمه یافت نشد.');
    return { status: 'deleted', id };
  }

  // ==========================================
  // 7️⃣ هوش مصنوعی (AI Management)
  // ==========================================

  @Post('ai/toggle')
  @ApiOperation({ summary: 'روشن یا خاموش کردن هوش مصنوعی' })
  async toggleAI(@Body() body: ToggleAiDto, @Request() req) {
    const userId = req.user.userId;
    const sessionId = this.getSessionId(req);

    // مطمئن می‌شویم سشن وجود دارد
    const session = await this.prisma.session.upsert({
        where: { id: sessionId },
        create: { 
            id: sessionId, 
            userId: userId, 
            status: 'DISCONNECTED', 
            aiEnabled: body.enabled 
        },
        update: { aiEnabled: body.enabled }
    });

    return { 
        status: 'success', 
        aiEnabled: session.aiEnabled, 
        message: session.aiEnabled ? 'هوش مصنوعی فعال شد' : 'هوش مصنوعی غیرفعال شد' 
    };
  }

  @Get('ai/status')
  @ApiOperation({ summary: 'بررسی وضعیت فعلی هوش مصنوعی' })
  async getAiStatus(@Request() req) {
    const sessionId = this.getSessionId(req);
    const session = await this.prisma.session.findUnique({
        where: { id: sessionId },
        select: { aiEnabled: true }
    });
    return { aiEnabled: session?.aiEnabled || false };
  }
}