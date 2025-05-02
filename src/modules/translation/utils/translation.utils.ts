import { Injectable } from '@nestjs/common';
import { TranslateService } from '../translation.service';

export interface TranslationConfig {
  sourceData: any;
  sourceLang: string;
  targetLang: string;
  ignoredFields: string[];
}

@Injectable()
export class TranslationUtils {
  private readonly delimiters = [
    ['{', '}'],
    ['#{', '}'],
    ['[', ']'],
    ['<', '>'],
    ['<', '/>'],
  ];

  getIgnoredFields(ignoredFieldsStr: string): string[] {
    if (!ignoredFieldsStr) {
      return [];
    }
    return ignoredFieldsStr.split(',');
  }

  isIgnored(key: string, ignoredFields: string[]): boolean {
    return ignoredFields.includes(key);
  }

  async translateJson(
    jsonData: string,
    fromLang: string,
    toLang: string,
    ignoredFields: string,
  ): Promise<string> {
    try {
      const result = JSON.parse(jsonData);
      const config: TranslationConfig = {
        sourceData: result,
        sourceLang: fromLang,
        targetLang: toLang,
        ignoredFields: this.getIgnoredFields(ignoredFields),
      };

      const translatedData = await this.translateJSON(config);
      return JSON.stringify(translatedData, null, 2);
    } catch (error) {
      throw new Error(`Failed to translate JSON: ${error.message}`);
    }
  }

  private async translateJSON(config: TranslationConfig): Promise<any> {
    const translatedData = {};
    const keys = Object.keys(config.sourceData);

    for (const key of keys) {
      const value = config.sourceData[key];

      if (this.isIgnored(key, config.ignoredFields)) {
        translatedData[key] = value;
        continue;
      }

      try {
        translatedData[key] = await this.translateElement(value, config);
      } catch (error) {
        console.error(`Error translating key ${key}:`, error);
        translatedData[key] = value;
      }
    }

    return translatedData;
  }

  private async translateElement(
    element: any,
    config: TranslationConfig,
  ): Promise<any> {
    if (element === null || element === undefined) {
      return element;
    }

    if (typeof element === 'object' && !Array.isArray(element)) {
      return this.translateNestedJSON(element, config);
    }

    if (Array.isArray(element)) {
      return this.translateArray(element, config);
    }

    if (typeof element === 'string') {
      return this.translateString(element, config);
    }

    return element;
  }

  private async translateNestedJSON(
    data: any,
    config: TranslationConfig,
  ): Promise<any> {
    const translatedData = {};
    const keys = Object.keys(data);

    for (const key of keys) {
      const value = data[key];

      if (this.isIgnored(key, config.ignoredFields)) {
        translatedData[key] = value;
        continue;
      }

      try {
        translatedData[key] = await this.translateElement(value, config);
      } catch (error) {
        throw new Error(`Error translating key ${key}: ${error.message}`);
      }
    }

    return translatedData;
  }

  private async translateArray(
    array: any[],
    config: TranslationConfig,
  ): Promise<any[]> {
    const translatedArray = [];
    for (const item of array) {
      translatedArray.push(await this.translateElement(item, config));
    }
    return translatedArray;
  }

  private async translateString(
    text: string,
    config: TranslationConfig,
  ): Promise<string> {
    const variables = this.extractVariables(text);
    let translatedText = await this.translateText(text, config);

    if (variables.length > 0) {
      const translatedVariables = this.extractVariables(translatedText);
      if (translatedVariables.length === variables.length) {
        for (let i = 0; i < variables.length; i++) {
          translatedText = translatedText.replace(
            translatedVariables[i],
            variables[i],
          );
        }
      }
    }

    return translatedText;
  }

  private async translateText(
    text: string,
    config: TranslationConfig,
  ): Promise<string> {
    // TODO: 实现实际的翻译逻辑，调用翻译 API
    // 这里只是一个示例实现
    return text;
  }

  private extractVariables(text: string): string[] {
    const variables: string[] = [];
    const processedIndexes = new Set<number>();

    for (const [startDelimiter, endDelimiter] of this.delimiters) {
      const pattern = `\\${startDelimiter}(.+?)\\${endDelimiter}`;
      const regex = new RegExp(pattern, 'g');
      let match;

      while ((match = regex.exec(text)) !== null) {
        const start = match.index;
        const end = start + match[0].length;
        let isOverlapping = false;

        for (let i = start; i < end; i++) {
          if (processedIndexes.has(i)) {
            isOverlapping = true;
            break;
          }
        }

        if (!isOverlapping) {
          variables.push(match[0]);
          for (let i = start; i < end; i++) {
            processedIndexes.add(i);
          }
        }
      }
    }

    return variables;
  }

  countJsonChars(jsonData: string, config: TranslationConfig): number {
    try {
      const data = JSON.parse(jsonData);
      return this.countElement(data, config);
    } catch (error) {
      throw new Error(`Failed to count JSON characters: ${error.message}`);
    }
  }

  private countElement(element: any, config: TranslationConfig): number {
    if (element === null || element === undefined) {
      return 0;
    }

    if (typeof element === 'object' && !Array.isArray(element)) {
      return this.countObject(element, config);
    }

    if (Array.isArray(element)) {
      return this.countArray(element, config);
    }

    if (typeof element === 'string') {
      return this.countString(element);
    }

    return 0;
  }

  private countObject(obj: any, config: TranslationConfig): number {
    let totalCount = 0;
    const keys = Object.keys(obj);

    for (const key of keys) {
      if (this.isIgnored(key, config.ignoredFields)) {
        continue;
      }
      totalCount += this.countElement(obj[key], config);
    }

    return totalCount;
  }

  private countArray(array: any[], config: TranslationConfig): number {
    let totalCount = 0;
    for (const item of array) {
      totalCount += this.countElement(item, config);
    }
    return totalCount;
  }

  private countString(text: string): number {
    return text.length;
  }
} 