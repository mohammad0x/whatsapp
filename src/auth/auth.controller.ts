import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { ApiTags, ApiOperation, ApiProperty } from '@nestjs/swagger';

class AuthDto {
  @ApiProperty({ example: 'admin@test.com' })
  email: string;

  @ApiProperty({ example: '123456' })
  password: string;
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  @ApiOperation({ summary: 'Create new user' })
  async signup(@Body() body: AuthDto) {
    return this.authService.signup(body.email, body.password);
  }

  @Post('login')
  @ApiOperation({ summary: 'Login and get Token' })
  async login(@Body() body: AuthDto) {
    return this.authService.login(body.email, body.password);
  }
}