import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Observable } from 'rxjs';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest();
   
    
    // نکته مهم: در Node.js تمام هدرها به حروف کوچک (lowercase) تبدیل می‌شوند
    // پس حتما باید با حروف کوچک چک کنیم
    const apiKey = request.headers['x-api-key'];

    const MY_SECRET_KEY = '1234';



    if (apiKey !== MY_SECRET_KEY) {
      console.log('⛔ Access Denied!');
      throw new UnauthorizedException('کلید API نامعتبر است یا ارسال نشده است! ⛔');
    }

    console.log('✅ Access Granted!');
    return true;
  }
}