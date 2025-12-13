import { Body, Controller, Post } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';

@Controller('whatsapp')
export class WhatsappController {
  constructor(private readonly whatsappService: WhatsappService) {}

  @Post('send')
  async sendMessage(@Body() body: { phone: string; message: string }) {
    // اینجا درخواست را از کاربر می‌گیریم
    // انتظار داریم JSON باشد: { "phone": "989123456789", "message": "Salam" }
    
    return this.whatsappService.sendTextMessage(body.phone, body.message);
    
  }
  // ... ایمپورت‌ها و متدهای قبلی

  @Post('send-image')
  async sendImage(@Body() body: { phone: string; imageUrl: string; caption: string }) {
    return this.whatsappService.sendImageMessage(body.phone, body.imageUrl, body.caption);
  }
}