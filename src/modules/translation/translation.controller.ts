import { Controller, Post, Body, Get, Param, UseGuards } from '@nestjs/common';
import { TranslationService } from './translation.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('translation')
@Controller('translation')
export class TranslationController {
  constructor(private readonly translationService: TranslationService) {}

  @Post()
  @ApiOperation({ summary: '创建翻译任务' })
  @ApiResponse({ status: 201, description: '翻译任务创建成功' })
  async createTranslationTask(
    @Body()
    body: {
      sourceText: string;
      sourceLanguage: string;
      targetLanguage: string;
      userId: string;
    },
  ) {
    return this.translationService.createTranslationTask(
      body.sourceText,
      body.sourceLanguage,
      body.targetLanguage,
      body.userId,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: '获取翻译结果' })
  @ApiResponse({ status: 200, description: '返回翻译结果' })
  async getTranslation(@Param('id') id: string) {
    return this.translationService.getTranslation(id);
  }

  @Get('user/:userId')
  @ApiOperation({ summary: '获取用户的所有翻译' })
  @ApiResponse({ status: 200, description: '返回用户的翻译列表' })
  async getTranslationsByUser(@Param('userId') userId: string) {
    return this.translationService.getTranslationsByUser(userId);
  }

  @Post('detect')
  @ApiOperation({ summary: '检测文本语言' })
  @ApiResponse({ status: 200, description: '返回检测到的语言' })
  async detectLanguage(@Body('text') text: string) {
    return this.translationService.detectLanguage(text);
  }
} 