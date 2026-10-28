import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from 'src/lib/decorators/permissions.decorator';
import { type CurrentUser, GetUser } from 'src/lib/decorators/user.decorator';
import { PermissionsEnum } from 'src/shared/enums/permission.enum';
import { AuditService } from './audit.service';
import { ListQuery, StartSurveillanceRequest } from './dto/traffic.req';
import { SurveillanceService } from './surveillance.service';
import { TrackService } from './track.service';
import { VehicleIdentityService } from './vehicle-identity.service';
import { VehicleSearchService } from './vehicle-search.service';

@ApiTags('Traffic - surveillance')
@Controller('surveillance')
export class SurveillanceController {
  constructor(private readonly surveillance: SurveillanceService) {}

  @ApiOperation({ summary: 'State of the two boxes, with live-view URLs (signed, 1 h); logs and run history for admins' })
  @Permissions({ permissions: [PermissionsEnum.OPERATE_SURVEILLANCE] })
  @Get('slots')
  slots(@GetUser() user: CurrentUser) {
    return this.surveillance.status(!!user.role?.permissions.includes(PermissionsEnum.ADMIN));
  }

  @Permissions({ permissions: [PermissionsEnum.OPERATE_SURVEILLANCE] })
  @Post('slots/:slot/start')
  start(@Param('slot') slot: string, @Body() dto: StartSurveillanceRequest, @GetUser() user: CurrentUser) {
    return this.surveillance.start(slot, dto, user);
  }

  @Permissions({ permissions: [PermissionsEnum.OPERATE_SURVEILLANCE] })
  @Post('slots/:slot/stop')
  stop(@Param('slot') slot: string, @GetUser() user: CurrentUser) {
    return this.surveillance.stop(slot, user);
  }

  @ApiOperation({ summary: 'Videos the vision service can open (its video folders + uploads)' })
  @Permissions({ permissions: [PermissionsEnum.OPERATE_SURVEILLANCE, PermissionsEnum.MANAGE_CAMERA] })
  @Get('videos')
  videos() {
    return this.surveillance.videos();
  }

  @ApiOperation({ summary: 'Signed URL to upload a video straight to the vision service (6 h)' })
  @Permissions({ permissions: [PermissionsEnum.OPERATE_SURVEILLANCE, PermissionsEnum.MANAGE_CAMERA] })
  @Post('upload-url')
  uploadUrl() {
    return this.surveillance.uploadUrl();
  }

  @ApiOperation({ summary: 'Recent runs of the boxes (admins)' })
  @Permissions({ permissions: [PermissionsEnum.ADMIN] })
  @Get('runs')
  runs(@Query() q: ListQuery) {
    return this.surveillance.history(q);
  }
}

@ApiTags('Traffic - tracking')
@Controller('track')
export class TrackController {
  constructor(
    private readonly track: TrackService,
    private readonly vehicleSearch: VehicleSearchService,
    private readonly identity: VehicleIdentityService,
    private readonly audit: AuditService,
  ) {}

  @ApiOperation({
    summary: 'Find vehicles in the whole camera network by Vehicle ID, plate or appearance (last camera first)',
  })
  @Permissions({ permissions: [PermissionsEnum.TRACK_VEHICLE] })
  @Get('vehicles')
  vehicles(
    @Query('q') q: string | undefined,
    @Query('by') by: string | undefined,
    @Query('colour') colour: string | undefined,
    @Query('type') type: string | undefined,
    @Query('vehicleClass') vehicleClass: string | undefined,
    @Query('cameraId') cameraId: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
    @GetUser() user: CurrentUser,
  ) {
    const mode = by === 'id' || by === 'plate' || by === 'appearance' ? by : undefined;
    return this.vehicleSearch.search(
      { q, by: mode, colour, type, vehicleClass, cameraId, from, to, page: Number(page) || 1, limit: Number(limit) || 20 },
      user,
    );
  }

  @ApiOperation({ summary: 'Give every Vehicle ID again from the stored sightings (after matching rules or links changed)' })
  @Permissions({ permissions: [PermissionsEnum.ADMIN] })
  @Post('vehicles/rebuild')
  async rebuildVehicles(@GetUser() user: CurrentUser) {
    const r = await this.identity.rebuild().catch((err: Error) => {
      throw new BadRequestException(err.message);
    });
    await this.audit.record(user, 'track.rebuild', 'vehicle', 'all', `Vehicle IDs rebuilt from ${r.sightings} sightings`);
    return r;
  }

  @ApiOperation({ summary: 'One vehicle: last camera, route across cameras, sightings, violations and tickets' })
  @Permissions({ permissions: [PermissionsEnum.TRACK_VEHICLE] })
  @Get('vehicles/:vid')
  vehicle(@Param('vid') vid: string, @GetUser() user: CurrentUser) {
    return this.vehicleSearch.detail(vid, user);
  }

  @ApiOperation({
    summary: 'Vehicles anywhere in the network that look like this one (appearance index; after it was last seen, or any time)',
  })
  @Permissions({ permissions: [PermissionsEnum.TRACK_VEHICLE] })
  @Get('vehicles/:vid/similar')
  similarVehicles(
    @Param('vid') vid: string,
    @Query('when') when: string | undefined,
    @Query('limit') limit: string | undefined,
    @GetUser() user: CurrentUser,
  ) {
    return this.vehicleSearch.similar(vid, when === 'any' ? 'any' : 'after', Number(limit) || 10, user);
  }

  @ApiOperation({ summary: 'Everywhere our cameras saw a registration (violations + plate sightings)' })
  @Permissions({ permissions: [PermissionsEnum.TRACK_VEHICLE] })
  @Get('plate')
  byPlate(@Query('q') q: string, @GetUser() user: CurrentUser) {
    return this.track.byPlate(q ?? '', user);
  }
}
