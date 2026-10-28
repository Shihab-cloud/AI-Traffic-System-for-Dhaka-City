import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from 'src/lib/decorators/auth.decorator';
import { AcceptInviteRequest } from 'src/lib/dto/request/token.req';
import { TokenService } from './token.service';

@ApiTags('Token Management')
@Controller('tokens')
export class TokenController {
  constructor(private tokenService: TokenService) {}

  @Public()
  @Get('verify-invite/:token')
  async verifyInvite(@Param('token') token: string) {
    const { email } = await this.tokenService.verifyInviteToken(token);
    return { valid: true, email };
  }

  @Public()
  @Get('verify-reset-password/:token')
  async verifyResetPassword(@Param('token') token: string) {
    return this.tokenService.verifyResetPasswordToken(token);
  }

  @Public()
  @Post('accept-invite')
  async acceptInvite(@Body() dto: AcceptInviteRequest) {
    return this.tokenService.acceptInvite(dto.token, dto.newPassword);
  }
}
