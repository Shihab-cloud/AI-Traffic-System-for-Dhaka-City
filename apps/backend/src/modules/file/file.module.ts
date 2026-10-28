import { FileController } from './file.controller';
import { FileService } from './file.service';
import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';

@Module({
  imports: [
    MulterModule.register({
      dest: './uploads',
    }),
  ],

  exports: [FileService],
  controllers: [FileController],
  providers: [FileService],
})
export class FileModule {}
