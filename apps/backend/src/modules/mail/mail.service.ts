import { Injectable, Logger } from '@nestjs/common';

import { ISendMailOptions, MailerService } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';
import { MfaMailPurposeEnum } from '../../shared/enums/mfa.enum';
import { PASSWORD_TEMPLATE_FILE_PATH } from './templates/password/PASSWORD_TEMPLATE_FILE_PATH.config';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  constructor(
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
  ) {}

  async sendEmailFromTemplate(sendMailOptions: ISendMailOptions): Promise<void> {
    await this.mailerService.sendMail(sendMailOptions);
  }

  async resetPassword(email: string, resetUrl: string, username: string = 'User'): Promise<void> {
    await this.sendEmailFromTemplate({
      to: email,
      subject: 'Reset your password',
      template: PASSWORD_TEMPLATE_FILE_PATH.PASSWORD_RESET,
      context: {
        appName: this.configService.get<string>('APP_NAME'),
        username,
        frontendUrl: resetUrl,
      },
    });
  }

  async sendWelcomeEmail(
    email: string,
    username: string = 'User',
    password: string,
  ): Promise<void> {
    await this.sendEmailFromTemplate({
      to: email,
      subject: 'Welcome to ' + this.configService.get<string>('APP_NAME'),
      template: PASSWORD_TEMPLATE_FILE_PATH.WELCOME,
      context: {
        appName: this.configService.get<string>('APP_NAME'),
        username,
        email,
        password,
        frontendUrl: this.configService.get<string>('FRONTEND_URL') + '/auth/signin',
      },
    });
  }

  async sendMfaCode(
    email: string,
    code: string,
    purpose: MfaMailPurposeEnum,
    expiryMinutes: number,
    username: string = 'User',
  ): Promise<void> {
    let purposeText: string;
    switch (purpose) {
      case MfaMailPurposeEnum.LOGIN:
        purposeText = 'sign in to your account';
        break;
      case MfaMailPurposeEnum.STEP_UP:
        purposeText = 'confirm a sensitive action';
        break;
      default:
        purposeText = 'verify your factor setup';
    }
    await this.mailerService.sendMail({
      to: email,
      subject: 'Your verification code',
      template: __dirname + '/templates/mfa/mfa-code',
      context: {
        appName: this.configService.get<string>('APP_NAME'),
        username,
        code,
        purposeText,
        expiryMinutes,
      },
    });
  }

  async sendMagicLink(email: string, magicLinkUrl: string, expirySeconds: number): Promise<void> {
    const expiryHours = Math.max(1, Math.round(expirySeconds / 3600));
    await this.sendEmailFromTemplate({
      to: email,
      subject: `Welcome to ${this.configService.get<string>('APP_NAME')}`,
      template: PASSWORD_TEMPLATE_FILE_PATH.MAGIC_LINK,
      context: {
        appName: this.configService.get<string>('APP_NAME'),
        magicLinkUrl,
        linkExpiry: expiryHours === 1 ? '1 hour' : `${expiryHours} hours`,
      },
    });
  }

  async sendVerifyEmail(email: string, verifyUrl: string, expirySeconds: number): Promise<void> {
    const expiryHours = Math.max(1, Math.round(expirySeconds / 3600));
    await this.sendEmailFromTemplate({
      to: email,
      subject: `Verify your email for ${this.configService.get<string>('APP_NAME')}`,
      template: PASSWORD_TEMPLATE_FILE_PATH.VERIFY_EMAIL,
      context: {
        appName: this.configService.get<string>('APP_NAME'),
        verifyUrl,
        linkExpiry: expiryHours === 1 ? '1 hour' : `${expiryHours} hours`,
      },
    });
  }

  async sendFirstLoginInvite(
    email: string,
    token: string,
    accountMakerEmail: string,
    username: string = 'User',
  ): Promise<void> {
    const expiryMs = Number(this.configService.get('RESET_TOKEN_EXPIRATION_TIME')) || 86400000;
    const expiryHours = Math.round(expiryMs / 3600000);
    await this.sendEmailFromTemplate({
      to: email,
      subject: 'Account invitation',
      template: PASSWORD_TEMPLATE_FILE_PATH.FIRST_LOGIN,
      context: {
        appName: this.configService.get<string>('APP_NAME'),
        username,
        linkExpiry: expiryHours === 1 ? '1 hour' : `${expiryHours} hours`,
        frontendUrl:
          this.configService.get<string>('FRONTEND_URL') + '/auth/accept-invite/' + token,
      },
    });
  }
}
