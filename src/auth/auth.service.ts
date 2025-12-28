import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async signup(email: string, password: string, name?: string) {
    // جلوگیری از ثبت ایمیل تکراری
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser) throw new ConflictException('Email already exists');

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await this.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name: name || 'Admin', // ✅ ذخیره نام
      },
    });
    return { message: 'User created successfully', userId: user.id };
  }

  async login(email: string, password: string) {
      // 1. پیدا کردن کاربر
      const user = await this.prisma.user.findUnique({ where: { email } });
      if (!user) throw new UnauthorizedException('Invalid credentials');

      // 2. چک کردن رمز عبور
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) throw new UnauthorizedException('Invalid credentials');

      // 3. ساخت توکن (نقش را در توکن هم قرار می‌دهیم)
      const payload = { sub: user.id, email: user.email, role: user.role };

      return {
        access_token: this.jwtService.sign(payload),
        
        // 👇 این بخش مهم است: اطلاعاتی که به فرانت‌ند می‌رود
        user: { 
          id: user.id, 
          email: user.email, 
          name: user.name, 
          role: user.role // ✅ این خط باعث می‌شود سایدبار درست کار کند
        } 
      };
    }
}