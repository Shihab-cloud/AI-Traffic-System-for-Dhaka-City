import { APIUrl } from '@/lib/constants/url.config';
import httpClient from '@/lib/utils/httpClient';
import { CreateUserPayload, UserUpdateRequest } from '../dtos/request/user-management.req';
import { TempPasswordResponse, UserResponse } from '../dtos/response/user.res';

class UserManagementService {
  async getUser(id: ID) {
    const res = await httpClient.get<UserResponse>(APIUrl.userManagement.getUser(id));

    return res.data;
  }

  async listUsers(params: QueryParams) {
    const res = await httpClient.get<PaginatedResponse<UserResponse>>(
      APIUrl.userManagement.getUsers(),
      {
        params,
      },
    );

    return res.data;
  }

  async createUser(payload: CreateUserPayload) {
    const res = await httpClient.post<UserResponse>(APIUrl.userManagement.createUser(), payload);

    return res.data;
  }

  async updateUser(id: ID, data: UserUpdateRequest) {
    const res = await httpClient.put<UserResponse>(APIUrl.userManagement.updateUser(id), data);

    return res.data;
  }

  async deleteUser(id: ID) {
    const res = await httpClient.delete(APIUrl.userManagement.deleteUser(id));

    return res.data;
  }

  async banUser(id: ID) {
    const res = await httpClient.patch<UserResponse>(APIUrl.userManagement.banUser(id));
    return res.data;
  }

  async unbanUser(id: ID) {
    const res = await httpClient.patch<UserResponse>(APIUrl.userManagement.unbanUser(id));
    return res.data;
  }

  async revokeSessions(id: ID) {
    const res = await httpClient.post(APIUrl.userManagement.revokeSessions(id));

    return res.data;
  }

  async resetCredentials(id: ID) {
    const res = await httpClient.post<TempPasswordResponse>(
      APIUrl.userManagement.resetCredentials(id),
    );

    return res.data;
  }
}

const userManagementService = new UserManagementService();

export default userManagementService;
