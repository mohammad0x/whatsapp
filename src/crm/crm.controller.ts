import { Body, Controller, Get, Param, Patch, Post, UseGuards, Request } from '@nestjs/common';
import { CrmService } from './crm.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('CRM & TeamInbox')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('crm')
export class CrmController {
  constructor(private readonly crmService: CrmService) {}

  // 1️⃣ تغییر وضعیت چت
  @Patch('conversations/:id/status')
  @ApiOperation({ summary: 'تغییر وضعیت چت (OPEN/CLOSED)' })
  async changeStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.crmService.updateConversationStatus(Number(id), status);
  }

  // 2️⃣ اختصاص چت به ایجنت
  @Patch('conversations/:id/assign')
  @ApiOperation({ summary: 'اختصاص چت به یک اپراتور' })
  async assignChat(@Param('id') id: string, @Body('agentId') agentId: number) {
    return this.crmService.assignConversation(Number(id), agentId);
  }

  // 3️⃣ دریافت اطلاعات مشتری
  @Get('contacts/:phone')
  @ApiOperation({ summary: 'دریافت پروفایل کامل مشتری' })
  async getContact(@Param('phone') phone: string) {
    return this.crmService.getContactDetails(phone);
  }

  // 4️⃣ افزودن یادداشت برای مشتری
  @Post('contacts/:id/notes')
  @ApiOperation({ summary: 'افزودن یادداشت محرمانه' })
  async addNote(@Param('id') id: string, @Body() body: { text: string }, @Request() req) {
    return this.crmService.addNote(Number(id), body.text, "Admin"); 
  }

  // 5️⃣ مدیریت تگ‌ها
  @Get('tags')
  async getTags() {
    return this.crmService.getAllTags();
  }

  @Post('tags')
  async createTag(@Body() body: { name: string; color: string }) {
    return this.crmService.createTag(body.name, body.color);
  }

  @Post('contacts/:id/tags')
  async addTag(@Param('id') id: string, @Body('tagId') tagId: number) {
    return this.crmService.addTagToContact(Number(id), tagId);
  }

  // 6️⃣ پاسخ‌های آماده
  @Get('canned-responses')
  async getCanned(@Request() req) {
    return this.crmService.getCannedResponses(req.user.userId);
  }

  @Post('canned-responses')
  async createCanned(@Body() body: { shortcut: string; content: string }, @Request() req) {
    return this.crmService.createCannedResponse(req.user.userId, body.shortcut, body.content);
  }

  // 7️⃣ مدیریت ایجنت‌ها
  @Get('agents')
  async getAgents(@Request() req) {
    return this.crmService.getAgents(req.user.userId);
  }

  @Post('agents')
  async createAgent(@Body() body: any, @Request() req) {
    return this.crmService.createAgent(req.user.userId, body);
  }
}