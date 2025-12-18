import { Body, Controller, UseInterceptors, UploadedFile, Get, Param, Post, UseGuards, Request, BadRequestException, Delete } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { ApiBearerAuth, ApiConsumes, ApiBody, ApiOperation, ApiTags, ApiProperty } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FileInterceptor } from '@nestjs/platform-express'; 
import { PrismaService } from '../prisma/prisma.service'; // ✅ ایمپورت شده

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
  @ApiProperty({ description: 'نام فایل (مثال: invoice.pdf)' })
  fileName: string;
  @ApiProperty({ description: 'توضیحات (اختیاری)', required: false })
  caption: string;
}

class SendBulkDto {
  @ApiProperty({ description: 'لیست شماره‌ها', type: [String] })
  phones: string[];
  @ApiProperty({ description: 'پیام همگانی' })
  message: string;
  @ApiProperty({ description: 'تاخیر بین پیام‌ها (ثانیه)', default: 5 })
  delay: number;
}

class SetWebhookDto {
  @ApiProperty({ description: 'آدرس سرور شما برای دریافت پیام‌ها' })
  url: string;
}

@ApiTags('WhatsApp')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('whatsapp')
export class WhatsappController {
  // ✅ فیکس: اضافه کردن private readonly prisma: PrismaService
  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly prisma: PrismaService 
  ) {}

  private getSessionId(req: any): string {
    return `session_${req.user.userId}`;
  }

  @Post('start')
  @ApiOperation({ summary: 'ساخت و روشن کردن ربات برای کاربر جاری' })
  async startSession(@Body() body: StartSessionDto, @Request() req) {
    const userId = req.user.userId;
    const sessionId = this.getSessionId(req);
    return this.whatsappService.createSession(sessionId, userId);
  }

  @Get('status')
  @ApiOperation({ summary: 'بررسی وضعیت اتصال من و دریافت QR کد' })
  async getStatus(@Request() req) {
    const userId = req.user.userId;
    const sessionId = this.getSessionId(req);
    return this.whatsappService.getSessionStatus(sessionId, userId);
  }

  @Post('send-text')
  @ApiOperation({ summary: 'ارسال پیام متنی' })
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
  @ApiOperation({ summary: 'آپلود عکس از سیستم' })
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
    if (!file) throw new BadRequestException('❌ لطفا یک فایل انتخاب کنید!');

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

  @Post('send-bulk')
  @ApiOperation({ summary: 'ارسال پیام گروهی' })
  async sendBulk(@Body() body: SendBulkDto, @Request() req) {
    const sessionId = this.getSessionId(req);
    const delayTime = (body.delay || 5) * 1000;
    const results: any[] = [];

    for (const phone of body.phones) {
        try {
            await this.whatsappService.sendTextMessage(sessionId, phone, body.message, req.user.userId);
            results.push({ phone, status: 'sent' });
            if (body.phones.length > 1) await new Promise(r => setTimeout(r, delayTime));
        } catch (error) {
            results.push({ phone, status: 'failed', error: error.message });
        }
    }
    return { summary: 'ارسال انبوه تمام شد', results };
  }

  @Post('webhook')
  @ApiOperation({ summary: 'تنظیم آدرس وب‌هوک برای دریافت پیام‌ها' })
  async setWebhook(@Body() body: SetWebhookDto, @Request() req) {
    const sessionId = this.getSessionId(req);
    return this.whatsappService.setWebhook(sessionId, body.url, req.user.userId);
  }
  
  @Get('contacts')
  @ApiOperation({ summary: 'دریافت لیست کسانی که با آن‌ها چت کرده‌اید' })
  async getContacts(@Request() req) {
    const sessionId = this.getSessionId(req);
    return this.whatsappService.getContacts(sessionId);
  }

  @Get('history/:phone')
  @ApiOperation({ summary: 'دریافت تاریخچه پیام‌ها با یک شماره خاص' })
  async getChatHistory(@Param('phone') phone: string, @Request() req) {
    const sessionId = this.getSessionId(req);
    return this.whatsappService.getChatHistory(sessionId, phone);
  }

  @UseGuards(JwtAuthGuard)
  @Post('keywords')
  async addKeyword(@Body() body: { trigger: string; response: string }, @Request() req) {
    return this.prisma.keyword.create({
      data: {
        trigger: body.trigger.toLowerCase().trim(),
        response: body.response,
        userId: req.user.userId,
      },
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('keywords')
  async getKeywords(@Request() req) {
    return this.prisma.keyword.findMany({
      where: { userId: req.user.userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  @UseGuards(JwtAuthGuard)
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