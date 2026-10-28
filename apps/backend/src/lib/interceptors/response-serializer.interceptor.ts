import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ClassConstructor, plainToInstance } from 'class-transformer';
import { Observable, map } from 'rxjs';

@Injectable()
export class ResponseSerializerInterceptor<T> implements NestInterceptor<any, T> {
  constructor(private readonly classType: ClassConstructor<T>) {}

  intercept(context: ExecutionContext, next: CallHandler<any>): Observable<T> {
    return next.handle().pipe(
      map((data) => {
        return plainToInstance(this.classType, data, {
          excludeExtraneousValues: true,
        });
      }),
    );
  }
}
