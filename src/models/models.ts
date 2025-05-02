import OrderedMap from 'orderedmap';

export interface TranslationRequest {
  text: string[];
  sourceLang?: string;
  targetLang: string;
  splitSentences?: string;
  preserveFormatting?: boolean;
  formality?: string;
  glossaryId?: string;
  tagHandling?: string;
  outlineDetection?: boolean;
}

export interface TranslationResponse {
  detectedSourceLanguage: string;
  text: string;
}

export interface Config {
  sourceData: OrderedMap;
  translatedFile: OrderedMap;
  ignoredFields: string[];
  sourceLang: string;
  targetLang: string;
  apiEndpoint: string;
  apiKey: string;
}

export interface Response<T> {
  code: number;
  msg: string;
  data: T;
}

export interface WebhookConfigRequest {
  webhookUrl: string;
}

export interface WebhookConfig {
  id: number;
  userId: string;
  webhookUrl: string;
}

export interface WebhookConfigCreate {
  userId: string;
  webhookUrl: string;
}

export interface HistoryEntry {
  timestamp: Date;
  webhookUrl: string;
  status: string;
  responseCode: number;
  actions: string[];
  userId: string;
}

export interface Statistics {
  totalRequests: number;
  successful: number;
  failed: number;
  successRate: number;
} 