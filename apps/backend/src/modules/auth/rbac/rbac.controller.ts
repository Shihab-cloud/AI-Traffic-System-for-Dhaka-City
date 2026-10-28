import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Permissions } from 'src/lib/decorators/permissions.decorator';
import { RequiresStepUp } from 'src/lib/decorators/step-up.decorator';
import type { CurrentUser } from 'src/lib/decorators/user.decorator';
import { GetUser } from 'src/lib/decorators/user.decorator';
import { ResponseSerializerInterceptor } from 'src/lib/interceptors/response-serializer.interceptor';
import { QueryTransformPipe } from 'src/lib/pipes/query.pipe';
import { ParamIdValidationPipe } from 'src/lib/pipes/validation.pipe';
import { PaginationQueryDto, PaginationQueryOptions } from 'src/shared/dtos/query.dto';
import { MfaStepUpScope } from 'src/shared/enums/mfa.enum';
import { PermissionsEnum } from 'src/shared/enums/permission.enum';
import { RoleCreationRequest } from '../../../lib/dto/request/role.req';
import { PaginatedRoleResponse, RoleResponse } from '../../../lib/dto/response/role.res';
import { RbacService } from './rbac.service';

@ApiTags('Role-Based Access Control')
@Controller('rbac')
export class RbacController {
  constructor(private readonly rbacService: RbacService) {}

  @ApiOperation({ summary: 'Create a new role' })
  @ApiResponse({ type: RoleResponse })
  @Permissions({ permissions: [PermissionsEnum.CREATE_ROLE] })
  @RequiresStepUp(MfaStepUpScope.ROLE_CREATE)
  @UseInterceptors(new ResponseSerializerInterceptor(RoleResponse))
  @Post('roles')
  async createRole(@Body() roleCreationRequest: RoleCreationRequest, @GetUser() user: CurrentUser) {
    const result = await this.rbacService.createRole(roleCreationRequest, user);

    return result;
  }

  @ApiOperation({ summary: 'Get all roles' })
  @ApiResponse({ type: PaginatedRoleResponse })
  @ApiQuery({ type: PaginationQueryOptions })
  @Permissions({ permissions: [PermissionsEnum.READ_ROLE] })
  @UseInterceptors(new ResponseSerializerInterceptor(PaginatedRoleResponse))
  @Get('roles')
  async getAllRoles(@Query(QueryTransformPipe) query: PaginationQueryDto) {
    const result = await this.rbacService.getAllRoles(query);

    return result;
  }

  @ApiOperation({ summary: 'Get a role by ID' })
  @ApiResponse({ type: RoleResponse })
  @Permissions({ permissions: [PermissionsEnum.READ_ROLE] })
  @UseInterceptors(new ResponseSerializerInterceptor(RoleResponse))
  @Get('roles/:roleId')
  async getRoleById(@Param('roleId', ParamIdValidationPipe) roleId: string) {
    const result = await this.rbacService.getRoleById(roleId);

    return result;
  }

  @ApiOperation({ summary: 'Update a role' })
  @ApiResponse({ type: RoleResponse })
  @Permissions({ permissions: [PermissionsEnum.UPDATE_ROLE] })
  @RequiresStepUp(MfaStepUpScope.ROLE_UPDATE)
  @UseInterceptors(new ResponseSerializerInterceptor(RoleResponse))
  @Put('roles/:roleId')
  async updateRole(
    @Param('roleId', ParamIdValidationPipe) roleId: string,
    @Body() updateRoleDto: RoleCreationRequest,
    @GetUser() user: CurrentUser,
  ) {
    const result = await this.rbacService.updateRole(roleId, updateRoleDto, user);

    return result;
  }

  @ApiOperation({ summary: 'Delete a role' })
  @ApiResponse({ type: RoleResponse })
  @Permissions({ permissions: [PermissionsEnum.DELETE_ROLE] })
  @RequiresStepUp(MfaStepUpScope.ROLE_DELETE)
  @UseInterceptors(new ResponseSerializerInterceptor(RoleResponse))
  @Delete('roles/:roleId')
  async deleteRole(
    @Param('roleId', ParamIdValidationPipe) roleId: string,
    @GetUser() user: CurrentUser,
  ) {
    const result = await this.rbacService.deleteRole(roleId, user);

    return result;
  }

  @ApiOperation({ summary: 'Get all permissions' })
  @Permissions({ permissions: [PermissionsEnum.READ_ROLE] })
  @Get('permissions')
  getAllPermissions() {
    const result = this.rbacService.getAllPermissions();

    return result;
  }
}
