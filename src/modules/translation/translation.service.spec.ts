import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager } from '@mikro-orm/core';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bull';
import { TranslationService } from './translation.service';
import { WebhookService } from '../webhook/webhook.service';
import { TranslationUtils } from './utils/translation.utils';
import { Translation } from './entities/translation.entity';
import { TranslationTask, UserJsonData, WebhookConfig } from './entities/translation-task.entity';
import { of } from 'rxjs';

describe('TranslationService', () => {
  let service: TranslationService;
  let em: EntityManager;
  let httpService: HttpService;
  let webhookService: WebhookService;
  let translationUtils: TranslationUtils;

  const mockEntityManager = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    persistAndFlush: jest.fn(),
  };

  const mockHttpService = {
    post: jest.fn(),
  };

  const mockWebhookService = {
    notifyTranslationComplete: jest.fn(),
  };

  const mockTranslationUtils = {
    translateJson: jest.fn(),
    getIgnoredFields: jest.fn(),
    countJsonChars: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TranslationService,
        {
          provide: EntityManager,
          useValue: mockEntityManager,
        },
        {
          provide: HttpService,
          useValue: mockHttpService,
        },
        {
          provide: WebhookService,
          useValue: mockWebhookService,
        },
        {
          provide: TranslationUtils,
          useValue: mockTranslationUtils,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: getQueueToken('translation'),
          useValue: {
            add: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<TranslationService>(TranslationService);
    em = module.get<EntityManager>(EntityManager);
    httpService = module.get<HttpService>(HttpService);
    webhookService = module.get<WebhookService>(WebhookService);
    translationUtils = module.get<TranslationUtils>(TranslationUtils);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createTranslationTask', () => {
    it('应该创建一个新的翻译任务', async () => {
      const userId = 'user123';
      const content = 'test content';
      const mockTask = { id: 'task123', userId, content, status: 'pending' };
      
      mockEntityManager.create.mockReturnValue(mockTask);
      mockEntityManager.persistAndFlush.mockResolvedValue(undefined);

      const result = await service.createTranslationTask(userId, content);
      
      expect(result).toEqual(mockTask);
      expect(mockEntityManager.create).toHaveBeenCalledWith(TranslationTask, expect.any(Object));
      expect(mockEntityManager.persistAndFlush).toHaveBeenCalledWith(mockTask);
    });
  });

  describe('handleTranslationTask', () => {
    it('应该成功处理翻译任务', async () => {
      const taskId = 'task123';
      const mockTask = {
        id: taskId,
        userId: 'user123',
        content: 'test content',
        status: 'pending',
        isTranslated: false,
        charTotal: 100,
      };
      const mockUserData = {
        id: taskId,
        originJson: '{"text": "hello"}',
        fromLang: 'en',
        toLang: 'zh',
        ignoredFields: '',
      };
      const mockTranslatedJson = '{"text": "你好"}';

      mockEntityManager.findOne
        .mockResolvedValueOnce(mockTask)
        .mockResolvedValueOnce(mockUserData);
      mockTranslationUtils.translateJson.mockResolvedValue(mockTranslatedJson);

      await service.handleTranslationTask(taskId);

      expect(mockEntityManager.persistAndFlush).toHaveBeenCalled();
      expect(mockTask.isTranslated).toBe(true);
    });

    it('当任务不存在时应该抛出错误', async () => {
      mockEntityManager.findOne.mockResolvedValue(null);

      await expect(service.handleTranslationTask('nonexistent')).rejects.toThrow('Translation task not found');
    });
  });

  describe('translateText', () => {
    it('应该成功翻译文本', async () => {
      const text = 'Hello';
      const sourceLanguage = 'en';
      const targetLanguage = 'zh';
      const expectedTranslation = '你好';

      // Mock Alimt client response
      const mockResponse = {
        statusCode: 200,
        body: {
          data: {
            translated: expectedTranslation,
          },
        },
      };

      // @ts-ignore
      service.translateClient.translateGeneralWithOptions = jest.fn().mockResolvedValue(mockResponse);

      const result = await service.translateText(text, sourceLanguage, targetLanguage);
      expect(result).toBe(expectedTranslation);
    });
  });

  describe('getTranslation', () => {
    it('应该返回指定ID的翻译', async () => {
      const translationId = 'trans123';
      const mockTranslation = { id: translationId, sourceText: 'Hello' };
      
      mockEntityManager.findOne.mockResolvedValue(mockTranslation);

      const result = await service.getTranslation(translationId);
      expect(result).toEqual(mockTranslation);
      expect(mockEntityManager.findOne).toHaveBeenCalledWith(Translation, { id: translationId });
    });
  });

  describe('updateTranslationStatus', () => {
    it('应该更新翻译状态并在完成时通知webhook', async () => {
      const translationId = 'trans123';
      const status = 'completed';
      const targetText = '你好';
      const mockTranslation = {
        id: translationId,
        userId: 'user123',
        status: 'processing',
        targetText: '',
      };

      mockEntityManager.findOne.mockResolvedValue(mockTranslation);
      mockEntityManager.persistAndFlush.mockResolvedValue(undefined);

      await service.updateTranslationStatus(translationId, status, targetText);

      expect(mockTranslation.status).toBe(status);
      expect(mockTranslation.targetText).toBe(targetText);
      expect(mockWebhookService.notifyTranslationComplete).toHaveBeenCalledWith(
        mockTranslation.userId,
        translationId,
        targetText,
      );
    });
  });
});