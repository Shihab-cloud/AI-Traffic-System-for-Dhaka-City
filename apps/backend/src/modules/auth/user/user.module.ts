import { Module } from '@nestjs/common';
import { TokenModule } from '../token/token.module';
import { UserController } from './user.controller';
import { UserService } from './user.service';

@Module({
  // TokenModule owns the better-auth `accounts` collection, which holds the
  // credential a password change has to write.
  imports: [TokenModule],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
