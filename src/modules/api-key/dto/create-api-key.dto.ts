import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsDateString } from 'class-validator';

export class CreateApiKeyDto {
  @ApiProperty({
    description: 'API Key 的名称',
    example: 'Production API Key',
  })
  @IsString()
  name: string;

  @ApiProperty({
    description: 'API Key 的过期时间（可选）',
    example: '2024-12-31T23:59:59Z',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: Date;
} 