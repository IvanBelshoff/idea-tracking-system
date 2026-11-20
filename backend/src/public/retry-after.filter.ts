import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';

/** Acrescenta `Retry-After` às respostas 429 (CA-RN-36.1). */
@Catch(HttpException)
export class RetryAfterFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const retryAfter = (exception as HttpException & { retryAfter?: number }).retryAfter;
    if (exception.getStatus() === 429 && retryAfter) res.setHeader('Retry-After', String(retryAfter));
    res.status(exception.getStatus()).json(exception.getResponse());
  }
}
