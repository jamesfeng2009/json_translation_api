import { Controller, Post, Body, Get, Param, UseGuards, Req } from '@nestjs/common';
import { TranslationService } from './translation.service';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TranslationTaskPayload } from './dto/translation-task.dto';

@ApiTags('translation')
@Controller('translation')
@ApiBearerAuth()
export class TranslationController {
  constructor(private readonly translationService: TranslationService) {}

  @Post('task')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '创建翻译任务' })
  @ApiResponse({ status: 201, description: '成功创建翻译任务' })
  @ApiResponse({ status: 400, description: '请求参数错误' })
  @ApiResponse({ status: 401, description: '未授权' })
  async createTranslationTask(@Req() req: any, @Body() payload: TranslationTaskPayload) {
    return this.translationService.createTranslationTask(req.user.id, payload.taskId);
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