import { PasswordUpdateRequest, ProfileUpdateRequest } from '../dtos/request/user.req';

import { APIUrl } from '@/lib/constants/url.config';
import { UserResponse } from '../dtos/response/user.res';
import httpClient from '@/lib/utils/httpClient';

class UserService {
  async getUser(id: ID) {
    const res = await httpClient.get<UserResponse>(APIUrl.user.getUser(id));

    return res.data;
  }

  async getProfile() {
    const res = await httpClient.get<UserResponse>(APIUrl.user.getProfile());

    return res.data;
  }

  async updateProfile(data: ProfileUpdateRequest) {
    const res = await httpClient.put<UserResponse>(APIUrl.user.profileUpdate(), data);

    return res.data;
  }

  async updatePassword(data: PasswordUpdateRequest) {
    const res = await httpClient.put<string>(APIUrl.user.passwordUpdate(), data);

    return res.data;
  }
}

const userService = new UserService();

export default userService;
