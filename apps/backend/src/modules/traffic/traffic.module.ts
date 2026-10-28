import { Module } from '@nestjs/common';
import { FileModule } from '../file/file.module';
import { NotificationModule } from '../notification/notification.module';
import { AuditService } from './audit.service';
import {
  CasesController,
  CitizenController,
  PaymentsController,
  ReportsController,
  ReviewsController,
  SslcommerzController,
} from './cases.controller';
import { CasesService } from './cases.service';
import { ClipsService } from './clips.service';
import { EvidenceService } from './evidence.service';
import { InvoiceService } from './invoice.service';
import { PassedVehiclesController } from './passed-vehicles.controller';
import { PassedVehiclesService } from './passed-vehicles.service';
import { PaymentsService } from './payments.service';
import { CamerasController, FinesController, VehiclesController } from './registry.controller';
import { RegistryService } from './registry.service';
import { ReportsService } from './reports.service';
import { SurveillanceController, TrackController } from './surveillance.controller';
import { SslcommerzService } from './sslcommerz.service';
import { SurveillanceService } from './surveillance.service';
import { AppearanceIndexService } from './appearance-index.service';
import { TrackService } from './track.service';
import { TrafficMailService } from './traffic-mail.service';
import { TrafficSeedService } from './traffic-seed.service';
import { VehicleIdentityService } from './vehicle-identity.service';
import { VehicleSearchService } from './vehicle-search.service';
import { ViolationsController } from './violations.controller';
import { ViolationsService } from './violations.service';
import { VisionClientService } from './vision-client.service';
import { VisionEventsController } from './vision-events.controller';
import { VisionEventsService } from './vision-events.service';
import { VlmService } from './vlm.service';

/**
 * Traffic enforcement: violations from the vision service, tickets, owner portal (reviews, payments through SSLCommerz
 * or the built-in test gateway, invoices),
 * surveillance control, the passed-vehicle list, cross-camera tracking, cameras / registry / fines, reports and audit.
 * Models come from the global SchemaModule.
 */
@Module({
  imports: [FileModule, NotificationModule],
  controllers: [
    VisionEventsController,
    ViolationsController,
    CamerasController,
    VehiclesController,
    FinesController,
    CasesController,
    ReviewsController,
    PaymentsController,
    SslcommerzController,
    CitizenController,
    ReportsController,
    SurveillanceController,
    TrackController,
    PassedVehiclesController,
  ],
  providers: [
    AuditService,
    EvidenceService,
    ClipsService,
    VisionClientService,
    VisionEventsService,
    VlmService,
    ViolationsService,
    CasesService,
    PaymentsService,
    SslcommerzService,
    InvoiceService,
    TrafficMailService,
    RegistryService,
    SurveillanceService,
    TrackService,
    AppearanceIndexService,
    VehicleIdentityService,
    VehicleSearchService,
    PassedVehiclesService,
    ReportsService,
    TrafficSeedService,
  ],
})
export class TrafficModule {}
