import { Body, Controller,ForbiddenException,UnauthorizedException, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ApiTags, ApiOperation, ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service'; // 👈 ۱. این خط را به بالای فایل اضافه کنید

class AuthDto {
  @ApiProperty({ example: 'admin@test.com' })
  @IsEmail({}, { message: 'فرمت ایمیل صحیح نیست' }) // ✅ اضافه شد
  email: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @MinLength(6, { message: 'رمز عبور باید حداقل ۶ کاراکتر باشد' }) // ✅ اضافه شد
  password: string;

  @ApiProperty({ example: 'Admin User', required: false })
  @IsOptional()
  @IsString()
  name?: string;
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService,
    private readonly prisma: PrismaService 
  ) {}


  // ✅ تغییر نام مسیر از signup به register (برای هماهنگی با تست و استاندارد)
  @Post('register')
  @ApiOperation({ summary: 'Create new user' })
  async signup(@Body() body: AuthDto) {
    return this.authService.signup(body.email, body.password, body.name);
  }

  @Post('login')
  @ApiOperation({ summary: 'Login and get Token' })
  async login(@Body() body: AuthDto) {
    return this.authService.login(body.email, body.password);
  }

  // 👑 لاگین جداگانه و اختصاصی برای مدیر کل در src/auth/auth.controller.ts
  @Post('super-admin/login')
  async superAdminLogin(@Body() body: any) {
    // ۱. از همان متد اصلی لاگین شما استفاده می‌کنیم که ایمیل و پسورد را چک می‌کند و توکن می‌دهد
    const result = await this.authService.login(body.email, body.password);
    
    // ۲. برای امنیت بیشتر، کاربر را از روی توکن یا دیتابیس مجدد چک می‌کنیم که حتماً SUPER_ADMIN باشد
    // (از آنجا که متد login شما در صورت اشتباه بودن رمز خودش ارور می‌دهد، اگر به این خط برسیم یعنی رمز درست است)
    const user = await this.prisma.user.findUnique({
      where: { email: body.email }
    });

    if (!user || user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('شما اجازه ورود به پنل مدیریت کل را ندارید!');
    }

    // ۳. بازگرداندن توکن معتبر سوپر ادمین
    return result;
  }
}