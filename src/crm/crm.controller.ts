import { Body, Controller, Query, Get, Param, Patch, Post,UseGuards, Request } from '@nestjs/common';
import { CrmService } from './crm.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { Delete ,ParseIntPipe} from '@nestjs/common'; 
import { Roles } from '../auth/roles.decorator'; // 👈 ایمپورت جدید
import { RolesGuard } from '../auth/roles.guard'; //

// 👇 کلاس‌های DTO برای نمایش در Swagger
// در بالای فایل src/crm/crm.controller.ts

// src/crm/crm.controller.ts

class CreateAgentDto {
  @ApiProperty({ example: 'Ali Rezaei', description: 'نام نمایشی' })
  name: string;

  @ApiProperty({ example: 'ali@example.com', description: 'ایمیل' })
  email: string;

  @ApiProperty({ example: '123456', description: 'رمز عبور' }) // 👈 این خط را اضافه کنید
  password: string;
}

class ChangeStatusDto {
  @ApiProperty({ example: 'CLOSED', description: 'وضعیت جدید (OPEN, CLOSED, PENDING)' })
  status: string;
}

class AssignAgentDto {
  @ApiProperty({ example: 1, description: 'شناسه اپراتور (Agent ID)' })
  agentId: number;
}

class CreateTagDto {
  @ApiProperty({ example: 'VIP', description: 'عنوان تگ' })
  name: string;
  @ApiProperty({ example: '#ff0000', description: 'کد رنگ' })
  color: string;
}

class AddNoteDto {
  @ApiProperty({ example: 'این مشتری نیاز به پیگیری دارد...', description: 'متن یادداشت' })
  text: string;
}


@ApiTags('CRM & TeamInbox')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('crm')
export class CrmController {
  constructor(private readonly crmService: CrmService) {}

  // 1️⃣ تغییر وضعیت چت
  @Patch('conversations/:id/status')
  @ApiOperation({ summary: 'تغییر وضعیت چت (OPEN/CLOSED)' })
  async changeStatus(@Param('id') id: string, @Body() body: ChangeStatusDto) {
    return this.crmService.updateConversationStatus(Number(id), body.status);
  }

  // 2️⃣ اختصاص چت به ایجنت
  @Patch('conversations/:id/assign')
  @ApiOperation({ summary: 'اختصاص چت به یک اپراتور' })
  async assignChat(@Param('id') id: string, @Body() body: AssignAgentDto) {
    return this.crmService.assignConversation(Number(id), body.agentId);
  }

  // 3️⃣ دریافت اطلاعات مشتری
  @Get('contacts/:phone')
  @ApiOperation({ summary: 'دریافت پروفایل کامل مشتری با شماره تلفن' })
  async getContact(@Param('phone') phone: string) {
    return this.crmService.getContactDetails(phone);
  }

  // 4️⃣ دریافت لیست مخاطبین (با جستجو)
  @Get('contacts')
  @ApiOperation({ summary: 'دریافت لیست مخاطبین (با قابلیت جستجو)' })
  async getAllContacts(@Query('search') search?: string) {
    return this.crmService.getContacts(search);
  }

  // 5️⃣ افزودن یادداشت برای مشتری
  @Post('contacts/:id/notes')
  @ApiOperation({ summary: 'افزودن یادداشت محرمانه' })
  async addNote(@Param('id') id: string, @Body() body: AddNoteDto, @Request() req) {
    const authorName = req.user.name || req.user.email || 'Unknown Agent';
    return this.crmService.addNote(Number(id), body.text, authorName); 
  }

  // 6️⃣ مدیریت تگ‌ها
  @Get('tags')
  @ApiOperation({ summary: 'لیست تگ‌ها' })
  async getTags() {
    return this.crmService.getAllTags();
  }

  @Post('tags')
  @ApiOperation({ summary: 'ساخت تگ جدید' })
  async createTag(@Body() body: CreateTagDto) {
    return this.crmService.createTag(body.name, body.color);
  }

  @Post('contacts/:id/tags')
  @ApiOperation({ summary: 'افزودن تگ به مخاطب' })
  async addTag(@Param('id') id: string, @Body('tagId') tagId: number) {
    return this.crmService.addTagToContact(Number(id), tagId);
  }


  // 8️⃣ مدیریت ایجنت‌ها
  @Get('agents')
  @ApiOperation({ summary: 'لیست اپراتورها' })
  async getAgents(@Request() req) {
    return this.crmService.getAgents(req.user.userId);
  }

  @Post('agents')
  @UseGuards(RolesGuard) // 🛡️ فعال کردن گارد نقش
  @Roles('ADMIN')        // 👮 فقط ادمین مجاز است
  @ApiOperation({ summary: 'ساخت اپراتور جدید' })
  async createAgent(@Body() body: CreateAgentDto, @Request() req) {
    // اکنون Swagger می‌داند که باید { name: string } بفرستد
    return this.crmService.createAgent(req.user.userId, body);
  }

  @Delete('agents/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({ summary: 'حذف اپراتور' })
  async deleteAgent(@Param('id') id: string) {
    return this.crmService.deleteAgent(Number(id));
  }

  @Delete('contacts/:id/tags/:tagId')
  @ApiOperation({ summary: 'حذف تگ از مخاطب' })
  async removeTagFromContact(
    @Param('id') id: string,
    @Param('tagId') tagId: string
  ) {
    return this.crmService.removeTagFromContact(Number(id), Number(tagId));
  }
  
  @Delete('canned-responses/:id')
  @ApiOperation({ summary: 'حذف پاسخ آماده' })
  async deleteCannedResponse(@Param('id', ParseIntPipe) id: number, @Request() req) {
    // پاس دادن userId برای اطمینان از مالکیت
    return this.crmService.deleteCannedResponse(id, req.user.userId);
  }
}