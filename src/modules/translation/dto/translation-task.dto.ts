import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsBoolean, IsNumber, IsOptional } from 'class-validator';

export class TranslationTaskPayload {
  @ApiProperty({ description: '用户ID' })
  @IsString()
  userId: string;

  @ApiProperty({ description: '翻译任务ID' })
  @IsString()
  id: string;

  @ApiProperty({ description: '任务ID' })
  @IsString()
  taskId: string;

  @ApiProperty({ description: '是否已翻译' })
  @IsBoolean()
  isTranslated: boolean;

  @ApiProperty({ description: '总字符数' })
  @IsNumber()
  charTotal: number;
}

export class TranslationPayload {
  @ApiProperty({ description: '原始JSON内容' })
  @IsString()
  jsonContentRaw: string;

  @ApiProperty({ description: '源语言' })
  @IsString()
  fromLang: string;

  @ApiProperty({ description: '目标语言' })
  @IsString()
  toLang: string;
}

export class TranslationResponse {
  @ApiProperty({ description: '消息' })
  @IsString()
  msg: string;

  @ApiProperty({ description: '状态码' })
  @IsNumber()
  code: number;

  @ApiProperty({ description: '翻译后的数据' })
  @IsString()
  data: string;
}

export class WebhookResponse {
  @ApiProperty({ description: '消息' })
  @IsString()
  msg: string;

  @ApiProperty({ description: '状态码' })
  @IsNumber()
  code: number;

  @ApiProperty({ description: '数据' })
  @IsString()
  data: string;
}

export class SendRetry {
  @ApiProperty({ description: 'Webhook ID' })
  @IsNumber()
  webhookId: number;

  @ApiProperty({ description: '任务ID' })
  @IsString()
  taskId: string;

  @ApiProperty({ description: '重试次数' })
  @IsNumber()
  attempt: number;

  @ApiProperty({ description: '状态' })
  @IsString()
  status: string;

  @ApiProperty({ description: '创建时间' })
  createdAt: Date;

  @ApiProperty({ description: '更新时间' })
  updatedAt: Date;

  @ApiProperty({ description: '发送内容' })
  payload: any;
} 