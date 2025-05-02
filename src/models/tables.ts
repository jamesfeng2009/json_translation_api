export interface ApiKeys {
  id: string;
  userId: string;
  apiKeyName: string;
  createdTime: string;
  updateTime: string;
  apiKey: string;
}

export interface UserJsonData {
  id: string;
  originJson: string;
  translatedJson: string;
  fromLang: string;
  toLang: string;
  createdTime: string;
  updateTime: string;
  taskId: string;
  isTranslated: boolean;
  ignoredFields: string;
  charTotal: number;
}

export interface User {
  id: string;
  fullName: string;
  avatarUrl: string;
  billingAddress: string;
  paymentMethod: string;
  totalCharactersUsed: number;
  charactersUsedThisMonth: number;
}

export interface WebhookConfig {
  id: number;
  userId: string;
  webhookUrl: string;
}

export interface UsageLogDaily {
  id: string;
  userId: string;
  totalCharacters: number;
  usageDate: string;
}

export interface Subscription {
  id: string;
  userId: string;
  status: string;
  metadata: Record<string, any>;
  priceId: string;
  quantity: number;
  cancelAtPeriodEnd: boolean;
  created: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  endedAt?: string;
  cancelAt?: string;
  canceledAt?: string;
  trialStart?: string;
  trialEnd?: string;
}

export interface Prices {
  id: string;
  productId: string;
  active: boolean;
  description?: string;
  unitAmount: number;
  currency: string;
  type: string;
  interval: string;
  intervalCount: number;
  trialPeriodDays: number;
  metadata: Record<string, any>;
} 