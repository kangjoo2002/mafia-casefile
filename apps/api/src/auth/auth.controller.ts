import { Body, Controller, Post } from '@nestjs/common';
import { AuthService, LoginInput, SignupInput } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  signup(@Body() body: SignupInput) {
    return this.authService.signup(body);
  }

  @Post('login')
  login(@Body() body: LoginInput) {
    return this.authService.login(body);
  }
}
