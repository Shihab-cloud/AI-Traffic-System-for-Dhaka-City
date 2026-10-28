import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { User, UserModel } from 'src/schemas/public/user.schema';
import { hashPassword, verifyPassword } from 'src/utils/password.util';
import { PasswordUpdateRequest, ProfileUpdateRequest } from '../../../lib/dto/request/user.req';
import { TokenService } from '../token/token.service';

@Injectable()
export class UserService {
  constructor(
    @InjectModel(User.name) private userModel: UserModel,
    private readonly tokenService: TokenService,
  ) {}

  async updateProfile(userId: string, updateUserDto: ProfileUpdateRequest) {
    if (await this.userModel.isEmailTaken(updateUserDto.email, userId))
      throw new HttpException('Email address is already registered', HttpStatus.CONFLICT);

    const current = await this.userModel.findById(userId).select('email').lean();
    if (!current) throw new HttpException('User not found', HttpStatus.NOT_FOUND);

    // Named fields, never a spread of the DTO: `roleId` / `status` /
    // `emailVerified` are real paths on this schema, and self-service profile
    // editing must not be able to reach them even if the ValidationPipe's
    // `whitelist` is ever turned off.
    const update: Record<string, unknown> = {
      firstName: updateUserDto.firstName,
      lastName: updateUserDto.lastName,
      email: updateUserDto.email,
      phone: updateUserDto.phone,
      name: `${updateUserDto.firstName} ${updateUserDto.lastName}`,
    };

    // A changed address is an unverified address. `sendResetPassword` refuses
    // to dispatch to an unverified one, which is what stops a reset link being
    // mailed to an address the account holder does not own.
    if (updateUserDto.email !== current.email) {
      update.emailVerified = false;
    }

    const user = await this.userModel.findByIdAndUpdate(userId, update);

    if (!user) throw new HttpException('User not found', HttpStatus.NOT_FOUND);

    return user;
  }

  /**
   * Change the caller's own password.
   *
   * The credential Better Auth authenticates against lives in `accounts`, not
   * on the user document — a change must reach both.
   */
  async updatePassword(userId: string, updatePasswordDto: PasswordUpdateRequest) {
    const user = await this.getUserById(userId);

    // Prove possession of the current password before changing it.
    // `users.password` is empty for invite-flow and magic-link users, so the
    // credential row is the authority — fall back to it rather than waiving
    // the check.
    const currentHash = user.password || (await this.tokenService.getCredentialHash(userId));

    // No credential at all means this is not a *change* — it would mint the
    // account's first password on the strength of a session alone, which turns
    // a stolen 15-minute JWT into permanent access for a social-only or
    // magic-link user. Setting a first password belongs to the reset flow,
    // which proves possession of the address.
    if (!currentHash) {
      throw new HttpException(
        'This account has no password set. Use the password reset flow to create one.',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (
      !updatePasswordDto.oldPassword ||
      !(await verifyPassword(updatePasswordDto.oldPassword, currentHash))
    )
      throw new HttpException('Invalid old password', HttpStatus.BAD_REQUEST);

    if (updatePasswordDto.oldPassword === updatePasswordDto.newPassword)
      throw new HttpException('Old and new password cannot be the same', HttpStatus.BAD_REQUEST);

    const hashed = await hashPassword(updatePasswordDto.newPassword);

    // Better Auth's credential row is what sign-in reads. Writing it also
    // revokes the sessions and device trust the old password established.
    await this.tokenService.updateCredentialPassword(userId, hashed);

    // Clear the mirror on the user document rather than rewriting it. Nothing
    // authenticates against it, and leaving a second copy of the hash around is
    // a second thing to keep in sync and a second thing to leak.
    // `pendingTempPassword` holds an admin-issued temp password in the clear,
    // and it is serialized into the session payload. Choosing a real password
    // is the moment it stops being needed.
    await user.updateOne({
      $unset: { password: 1, pendingTempPassword: 1 },
      mustResetPassword: false,
    });

    return 'Password updated successfully';
  }

  async getUserById(userId: string) {
    const user = await this.userModel.findById(userId).populate('role');

    if (!user) throw new HttpException('User not found', HttpStatus.NOT_FOUND);

    return user;
  }
}
