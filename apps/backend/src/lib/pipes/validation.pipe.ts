import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

import { isMongoId } from 'class-validator';

@Injectable()
export class ParamIdValidationPipe implements PipeTransform {
  transform(id: string) {
    if (!isMongoId(id)) {
      throw new BadRequestException('Invalid ID');
    }

    return id;
  }
}
