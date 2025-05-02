import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { ApiKeyService } from '../../user/api-key.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'];

    if (!apiKey) {
      return false;
    }

    return this.apiKeyService.validateApiKey(apiKey);
  }
} 