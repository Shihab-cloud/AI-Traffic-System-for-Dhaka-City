import { Module } from '@nestjs/common';
import { FaqController } from './faq.controller';
import { FaqService } from './faq.service';

// Models come from the global SchemaModule — no forFeature here.
@Module({
  controllers: [FaqController],
  providers: [FaqService],
})
export class FaqModule {}
