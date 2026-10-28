import { APIUrl } from '@/lib/constants/url.config';
import { RoleCreationRequest } from '../dtos/request/role.req';
import { RoleResponse } from '../dtos/response/role.res';
import httpClient from '@/lib/utils/httpClient';

class RbacService {
  async listRoles(params: QueryParams) {
    const res = await httpClient.get<PaginatedResponse<RoleResponse>>(APIUrl.role.getRoles(), {
      params,
    });

    return res.data;
  }

  async createRole(data: RoleCreationRequest) {
    const res = await httpClient.post<RoleResponse>(APIUrl.role.createRole(), data);

    return res.data;
  }

  async updateRole(id: ID, data: RoleCreationRequest) {
    const res = await httpClient.put<RoleResponse>(APIUrl.role.updateRole(id), data);

    return res.data;
  }

  async deleteRole(id: ID) {
    const res = await httpClient.delete<RoleResponse>(APIUrl.role.deleteRole(id));

    return res.data;
  }
}

const rbacService = new RbacService();

export default rbacService;
