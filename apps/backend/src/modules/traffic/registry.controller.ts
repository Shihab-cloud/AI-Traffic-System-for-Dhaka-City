import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from 'src/lib/decorators/permissions.decorator';
import { type CurrentUser, GetUser } from 'src/lib/decorators/user.decorator';
import { ParamIdValidationPipe } from 'src/lib/pipes/validation.pipe';
import { PermissionsEnum } from 'src/shared/enums/permission.enum';
import {
  AutoZonesRequest,
  CameraRequest,
  FineRequest,
  FrameRequest,
  ListQuery,
  NetworkRequest,
  VehicleRequest,
  ZonesRequest,
} from './dto/traffic.req';
import { RegistryService } from './registry.service';
import { SurveillanceService } from './surveillance.service';

const CAMERA_READERS = [
  PermissionsEnum.MANAGE_CAMERA,
  PermissionsEnum.READ_VIOLATION,
  PermissionsEnum.OPERATE_SURVEILLANCE,
  PermissionsEnum.TRACK_VEHICLE,
];

@ApiTags('Traffic - cameras')
@Controller('cameras')
export class CamerasController {
  constructor(
    private readonly registry: RegistryService,
    private readonly surveillance: SurveillanceService,
  ) {}

  @Permissions({ permissions: CAMERA_READERS })
  @Get()
  list(@Query('active') active?: string) {
    return this.registry.listCameras(active !== 'true');
  }

  @ApiOperation({ summary: 'One frame of a source, to draw zones on (data URL + size)' })
  @Permissions({ permissions: [PermissionsEnum.MANAGE_CAMERA] })
  @Post('frame')
  frame(@Body() dto: FrameRequest) {
    return this.surveillance.frame(dto.source, dto.atSec ?? 0);
  }

  @Permissions({ permissions: CAMERA_READERS })
  @Get(':id')
  get(@Param('id', ParamIdValidationPipe) id: string) {
    return this.registry.getCamera(id);
  }

  @Permissions({ permissions: [PermissionsEnum.MANAGE_CAMERA] })
  @Post()
  create(@Body() dto: CameraRequest, @GetUser() user: CurrentUser) {
    return this.registry.saveCamera(dto, user);
  }

  @Permissions({ permissions: [PermissionsEnum.MANAGE_CAMERA] })
  @Patch(':id')
  update(@Param('id', ParamIdValidationPipe) id: string, @Body() dto: CameraRequest, @GetUser() user: CurrentUser) {
    return this.registry.saveCamera(dto, user, id);
  }

  @ApiOperation({ summary: "Save a camera's zones (admins: Admin > Cameras and the surveillance page)" })
  @Permissions({ permissions: [PermissionsEnum.MANAGE_CAMERA] })
  @Patch(':id/zones')
  saveZones(@Param('id', ParamIdValidationPipe) id: string, @Body() dto: ZonesRequest, @GetUser() user: CurrentUser) {
    return this.registry.saveZones(id, dto.zones, user);
  }

  @ApiOperation({ summary: "Save a camera's place in the camera network: gates and links (multi-camera tracking)" })
  @Permissions({ permissions: [PermissionsEnum.MANAGE_CAMERA] })
  @Put(':id/network')
  saveNetwork(@Param('id', ParamIdValidationPipe) id: string, @Body() dto: NetworkRequest, @GetUser() user: CurrentUser) {
    return this.registry.saveNetwork(id, dto.network, user);
  }

  @ApiOperation({ summary: 'Learn the zones from traffic (a draft for the zone editor; nothing is saved)' })
  @Permissions({ permissions: [PermissionsEnum.MANAGE_CAMERA] })
  @Post(':id/auto-zones')
  startAutoZones(
    @Param('id', ParamIdValidationPipe) id: string,
    @Body() dto: AutoZonesRequest,
    @GetUser() user: CurrentUser,
  ) {
    return this.surveillance.startAutoZones(id, dto.source, user);
  }

  @ApiOperation({ summary: 'Progress of automatic zone learning, with the proposal when done' })
  @Permissions({ permissions: [PermissionsEnum.MANAGE_CAMERA] })
  @Get(':id/auto-zones')
  autoZones(@Param('id', ParamIdValidationPipe) id: string) {
    return this.surveillance.autoZones(id);
  }

  @Permissions({ permissions: [PermissionsEnum.MANAGE_CAMERA] })
  @Delete(':id/auto-zones')
  cancelAutoZones(@Param('id', ParamIdValidationPipe) id: string) {
    return this.surveillance.cancelAutoZones(id);
  }

  @ApiOperation({ summary: 'Delete (or deactivate, when violations refer to it)' })
  @Permissions({ permissions: [PermissionsEnum.MANAGE_CAMERA] })
  @Delete(':id')
  remove(@Param('id', ParamIdValidationPipe) id: string, @GetUser() user: CurrentUser) {
    return this.registry.deleteCamera(id, user);
  }
}

@ApiTags('Traffic - vehicle registry')
@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly registry: RegistryService) {}

  @Permissions({ permissions: [PermissionsEnum.MANAGE_VEHICLE] })
  @Get()
  list(@Query() q: ListQuery) {
    return this.registry.listVehicles(q);
  }

  @ApiOperation({ summary: 'Registry rows for a registration (exact, else same 6 digits)' })
  @Permissions({ permissions: [PermissionsEnum.MANAGE_VEHICLE, PermissionsEnum.ISSUE_TICKET] })
  @Get('lookup')
  lookup(@Query('registration') registration: string) {
    return this.registry.lookup(registration ?? '');
  }

  @Permissions({ permissions: [PermissionsEnum.MANAGE_VEHICLE] })
  @Post()
  create(@Body() dto: VehicleRequest, @GetUser() user: CurrentUser) {
    return this.registry.saveVehicle(dto, user);
  }

  @Permissions({ permissions: [PermissionsEnum.MANAGE_VEHICLE] })
  @Patch(':id')
  update(@Param('id', ParamIdValidationPipe) id: string, @Body() dto: VehicleRequest, @GetUser() user: CurrentUser) {
    return this.registry.saveVehicle(dto, user, id);
  }

  @Permissions({ permissions: [PermissionsEnum.MANAGE_VEHICLE] })
  @Delete(':id')
  remove(@Param('id', ParamIdValidationPipe) id: string, @GetUser() user: CurrentUser) {
    return this.registry.deleteVehicle(id, user);
  }
}

@ApiTags('Traffic - fines')
@Controller('fines')
export class FinesController {
  constructor(private readonly registry: RegistryService) {}

  @ApiOperation({ summary: 'Fine schedule (every signed-in user)' })
  @Get()
  list() {
    return this.registry.listFines();
  }

  @Permissions({ permissions: [PermissionsEnum.MANAGE_FINE] })
  @Put(':code')
  save(@Param('code') code: string, @Body() dto: FineRequest, @GetUser() user: CurrentUser) {
    return this.registry.saveFine(code.toUpperCase(), dto, user);
  }
}
