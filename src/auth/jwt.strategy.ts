import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable } from '@nestjs/common';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: 'MY_SUPER_SECRET_KEY', // باید با auth.module.ts یکی باشد
    });
  }

  async validate(payload: any) {
    return { userId: payload.sub, email: payload.email };
  }
}
// ... imports
// import { ExtractJwt, Strategy } from 'passport-jwt';
// import { PassportStrategy } from '@nestjs/passport'; // ✅ ایمپورت اضافه شد
// import { Injectable } from '@nestjs/common';
// import { ConfigService } from '@nestjs/config'; // ✅ ایمپورت اضافه شد

// @Injectable()
// export class JwtStrategy extends PassportStrategy(Strategy) {
//   constructor(configService: ConfigService) {
//     super({
//       jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
//       ignoreExpiration: false,
//       // اگر در فایل .env هنوز متغیری ندارید، از مقدار پیش‌فرض استفاده می‌کند
//       secretOrKey: configService.get<string>('JWT_SECRET') || 'MY_SUPER_SECRET_KEY',
//     });
//   }

//   async validate(payload: any) {
//     return { userId: payload.sub, email: payload.email };
//   }
// }