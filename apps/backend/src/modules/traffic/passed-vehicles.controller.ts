import { Controller, Get, Query, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from 'src/lib/decorators/permissions.decorator';
import { PermissionsEnum } from 'src/shared/enums/permission.enum';
import { PassedVehiclesQuery } from './dto/traffic.req';
import { PassedVehiclesService } from './passed-vehicles.service';

@ApiTags('Traffic - passed vehicles')
@Controller('passed-vehicles')
export class PassedVehiclesController {
  constructor(private readonly passed: PassedVehiclesService) {}

  @ApiOperation({ summary: 'Every vehicle the other-violations box saw pass, with plate and look (one camera / run)' })
  @Permissions({ permissions: [PermissionsEnum.TRACK_VEHICLE] })
  @Get()
  list(@Query() q: PassedVehiclesQuery) {
    return this.passed.list(q, q.page ?? 1, q.limit ?? 50);
  }

  @ApiOperation({ summary: 'Cameras, with how many vehicles each has listed (most recent first)' })
  @Permissions({ permissions: [PermissionsEnum.TRACK_VEHICLE] })
  @Get('cameras')
  cameras() {
    return this.passed.cameras();
  }

  @ApiOperation({ summary: 'Runs that listed vehicles at a camera (newest first)' })
  @Permissions({ permissions: [PermissionsEnum.TRACK_VEHICLE] })
  @Get('runs')
  runs(@Query() q: PassedVehiclesQuery) {
    return this.passed.runs(q.cameraId ?? '');
  }

  @ApiOperation({ summary: 'The list as a CSV file' })
  @Permissions({ permissions: [PermissionsEnum.TRACK_VEHICLE] })
  @Get('csv')
  async csv(@Query() q: PassedVehiclesQuery) {
    const file = await this.passed.csv(q);
    return new StreamableFile(file.data, { type: 'text/csv; charset=utf-8', disposition: `attachment; filename="${file.name}"` });
  }
}
