import { Body, Controller, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from 'src/lib/decorators/auth.decorator';
import { VisionClientService } from './vision-client.service';
import { VisionEventsService } from './vision-events.service';

/** Machine-to-machine: the vision service authenticates with the shared VISION_KEY, not a user session. */
@ApiExcludeController()
@Controller('vision')
export class VisionEventsController {
  constructor(
    private readonly vision: VisionClientService,
    private readonly events: VisionEventsService,
  ) {}

  @Public()
  @HttpCode(200)
  @Post('events')
  async ingest(@Headers('x-vision-key') key: string | undefined, @Body() body: Record<string, unknown>) {
    if (!this.vision.checkKey(key)) throw new UnauthorizedException('Bad vision key');
    return this.events.handle(body ?? {});
  }
}
