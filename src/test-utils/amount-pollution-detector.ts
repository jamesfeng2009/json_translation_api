/**
 * Amount 字段污染检测器
 * 专门用于检测测试环境中 amount 字段的全局污染问题
 */

export class AmountPollutionDetector {
  private static instance: AmountPollutionDetector;
  private pollutionFound = false;
  private pollutionDetails: string[] = [];

  static getInstance(): AmountPollutionDetector {
    if (!AmountPollutionDetector.instance) {
      AmountPollutionDetector.instance = new AmountPollutionDetector();
    }
    return AmountPollutionDetector.instance;
  }

  /**
   * 检测全局 amount 污染
   */
  detectGlobalPollution(): boolean {
    console.log('🔍 检测全局 amount 污染...');
    
    this.pollutionFound = false;
    this.pollutionDetails = [];

    // 1. 检测全局对象
    this.checkGlobalObjects();
    
    // 2. 检测原型链
    this.checkPrototypes();
    
    // 3. 检测 Jest 对象
    this.checkJestObjects();
    
    // 4. 检测模块缓存
    this.checkModuleCache();
    
    // 5. 测试对象行为
    this.testObjectBehavior();
    
    // 6. 检测可能的代理
    this.checkProxies();
    
    // 7. 检测属性描述符
    this.checkPropertyDescriptors();

    this.generateReport();
    return this.pollutionFound;
  }

  private checkGlobalObjects(): void {
    const globalObjects = ['global', 'window', 'self', 'globalThis'];
    
    globalObjects.forEach(objName => {
      try {
        const obj = (globalThis as any)[objName] || (global as any)[objName];
        if (obj && typeof obj === 'object') {
          const descriptor = Object.getOwnPropertyDescriptor(obj, 'amount');
          if (descriptor) {
            this.pollutionFound = true;
            this.pollutionDetails.push(`${objName}.amount 被定义`);
            console.log(`❌ 发现 ${objName}.amount:`, {
              value: descriptor.value,
              getter: !!descriptor.get,
              setter: !!descriptor.set,
              writable: descriptor.writable,
              enumerable: descriptor.enumerable,
              configurable: descriptor.configurable
            });
          }
        }
      } catch (e) {
        // 忽略错误
      }
    });
  }

  private checkPrototypes(): void {
    const prototypes = [
      { name: 'Object.prototype', obj: Object.prototype },
      { name: 'Array.prototype', obj: Array.prototype },
      { name: 'Function.prototype', obj: Function.prototype },
      { name: 'String.prototype', obj: String.prototype },
      { name: 'Number.prototype', obj: Number.prototype },
      { name: 'Boolean.prototype', obj: Boolean.prototype },
      { name: 'Date.prototype', obj: Date.prototype },
      { name: 'RegExp.prototype', obj: RegExp.prototype },
      { name: 'Error.prototype', obj: Error.prototype },
      { name: 'Promise.prototype', obj: Promise.prototype },
    ];

    prototypes.forEach(({ name, obj }) => {
      const descriptor = Object.getOwnPropertyDescriptor(obj, 'amount');
      if (descriptor) {
        this.pollutionFound = true;
        this.pollutionDetails.push(`${name}.amount 被定义`);
        console.log(`❌ 发现 ${name}.amount:`, {
          value: descriptor.value,
          getter: !!descriptor.get,
          setter: !!descriptor.set,
          writable: descriptor.writable,
          enumerable: descriptor.enumerable,
          configurable: descriptor.configurable
        });
      }
    });
  }

  private checkJestObjects(): void {
    const jestObjects = [
      'jest', 'expect', 'describe', 'it', 'test',
      'beforeEach', 'afterEach', 'beforeAll', 'afterAll'
    ];

    jestObjects.forEach(objName => {
      try {
        const obj = (global as any)[objName];
        if (obj && typeof obj === 'object') {
          const descriptor = Object.getOwnPropertyDescriptor(obj, 'amount');
          if (descriptor) {
            this.pollutionFound = true;
            this.pollutionDetails.push(`${objName}.amount 被定义`);
            console.log(`❌ 发现 ${objName}.amount:`, {
              value: descriptor.value,
              getter: !!descriptor.get,
              setter: !!descriptor.set,
              writable: descriptor.writable,
              enumerable: descriptor.enumerable,
              configurable: descriptor.configurable
            });
          }
        }
      } catch (e) {
        // 忽略错误
      }
    });
  }

  private checkModuleCache(): void {
    if (typeof require !== 'undefined' && (require as any).cache) {
      const cache = (require as any).cache;
      Object.keys(cache).forEach(modulePath => {
        const module = cache[modulePath];
        if (module && module.exports) {
          const descriptor = Object.getOwnPropertyDescriptor(module.exports, 'amount');
          if (descriptor) {
            this.pollutionFound = true;
            this.pollutionDetails.push(`模块 ${modulePath} 的 exports.amount 被定义`);
            console.log(`❌ 发现模块 ${modulePath} 的 exports.amount:`, {
              value: descriptor.value,
              getter: !!descriptor.get,
              setter: !!descriptor.set
            });
          }
        }
      });
    }
  }

  private testObjectBehavior(): void {
    console.log('🧪 测试对象行为...');
    
    const testObj = {
      amount: 100,
      amt: 200,
      value: 300
    };

    console.log('原始对象:', JSON.stringify(testObj));

    // 检查描述符
    const amountDescriptor = Object.getOwnPropertyDescriptor(testObj, 'amount');
    const amtDescriptor = Object.getOwnPropertyDescriptor(testObj, 'amt');
    const valueDescriptor = Object.getOwnPropertyDescriptor(testObj, 'value');

    console.log('amount 描述符:', {
      value: amountDescriptor?.value,
      getter: !!amountDescriptor?.get,
      setter: !!amountDescriptor?.set,
      writable: amountDescriptor?.writable,
      enumerable: amountDescriptor?.enumerable,
      configurable: amountDescriptor?.configurable
    });

    console.log('amt 描述符:', {
      value: amtDescriptor?.value,
      getter: !!amtDescriptor?.get,
      setter: !!amtDescriptor?.set,
      writable: amtDescriptor?.writable,
      enumerable: amtDescriptor?.enumerable,
      configurable: amtDescriptor?.configurable
    });

    console.log('value 描述符:', {
      value: valueDescriptor?.value,
      getter: !!valueDescriptor?.get,
      setter: !!valueDescriptor?.set,
      writable: valueDescriptor?.writable,
      enumerable: valueDescriptor?.enumerable,
      configurable: valueDescriptor?.configurable
    });

    // 测试修改值
    try {
      testObj.amount = 999;
      testObj.amt = 888;
      testObj.value = 777;

      console.log('修改后对象:', JSON.stringify(testObj));

      if (testObj.amount !== 999) {
        this.pollutionFound = true;
        this.pollutionDetails.push('amount 值被意外修改');
        console.log('❌ amount 值被意外修改!');
      } else {
        console.log('✅ amount 值正常');
      }

      if (testObj.amt !== 888) {
        this.pollutionFound = true;
        this.pollutionDetails.push('amt 值被意外修改');
        console.log('❌ amt 值被意外修改!');
      } else {
        console.log('✅ amt 值正常');
      }

      if (testObj.value !== 777) {
        this.pollutionFound = true;
        this.pollutionDetails.push('value 值被意外修改');
        console.log('❌ value 值被意外修改!');
      } else {
        console.log('✅ value 值正常');
      }
    } catch (e) {
      this.pollutionFound = true;
      this.pollutionDetails.push(`修改值时出错: ${e}`);
      console.log('❌ 修改值时出错:', e);
    }
  }

  private checkProxies(): void {
    console.log('🔍 检查代理对象...');
    
    const testObj = { amount: 100 };
    
    try {
      // 创建一个代理来模拟污染
      const proxy = new Proxy(testObj, {
        get(target, prop) {
          if (prop === 'amount') {
            console.log('❌ 检测到 amount 属性的代理 getter');
            return 1; // 强制返回 1
          }
          return target[prop as keyof typeof target];
        },
        set(target, prop, value) {
          if (prop === 'amount') {
            console.log('❌ 检测到 amount 属性的代理 setter');
            target[prop as keyof typeof target] = 1; // 强制设置为 1
            return true;
          }
          target[prop as keyof typeof target] = value;
          return true;
        }
      });

      console.log('测试代理对象:', proxy.amount);
      proxy.amount = 999;
      console.log('设置后:', proxy.amount);
      
    } catch (e) {
      console.log('⚠️ 代理测试失败:', e);
    }
  }

  private checkPropertyDescriptors(): void {
    console.log('🔍 检查属性描述符...');
    
    const globalFunctions = [
      'Object.defineProperty',
      'Object.defineProperties',
      'Reflect.defineProperty'
    ];

    globalFunctions.forEach(funcName => {
      try {
        const func = (global as any)[funcName.split('.')[0]]?.[funcName.split('.')[1]] ||
                    (globalThis as any)[funcName.split('.')[0]]?.[funcName.split('.')[1]];
        if (typeof func === 'function') {
          console.log(`✅ ${funcName} 可用`);
        }
      } catch (e) {
        console.log(`⚠️ ${funcName} 不可用:`, e);
      }
    });
  }

  private generateReport(): void {
    console.log('\n📊 检测报告:');
    if (this.pollutionFound) {
      console.log('❌ 发现 amount 字段污染!');
      console.log('污染详情:');
      this.pollutionDetails.forEach(detail => {
        console.log(`  - ${detail}`);
      });
      console.log('\n💡 建议解决方案:');
      console.log('  1. 检查 Jest 配置文件 (jest.config.js)');
      console.log('  2. 检查全局 mock 设置');
      console.log('  3. 检查测试环境变量');
      console.log('  4. 重启测试环境');
      console.log('  5. 清除 Jest 缓存: npm run test -- --clearCache');
      console.log('  6. 检查是否有全局的 Object.defineProperty 调用');
      console.log('  7. 检查是否有全局的 Proxy 设置');
    } else {
      console.log('✅ 未发现 amount 字段污染');
    }
  }

  /**
   * 快速检测 - 只测试对象行为
   */
  quickDetect(): boolean {
    console.log('⚡ 快速检测 amount 字段行为...');
    
    const testObj = {
      amount: 100,
      amt: 200
    };

    console.log('原始对象:', JSON.stringify(testObj));
    
    try {
      testObj.amount = 999;
      testObj.amt = 888;
      
      console.log('修改后对象:', JSON.stringify(testObj));
      
      if (testObj.amount !== 999) {
        console.log('❌ amount 值被污染!');
        return true;
      }
      
      if (testObj.amt !== 888) {
        console.log('❌ amt 值被污染!');
        return true;
      }
      
      console.log('✅ 字段行为正常');
      return false;
    } catch (e) {
      console.log('❌ 修改值时出错:', e);
      return true;
    }
  }

  /**
   * 检测特定对象的 amount 字段
   */
  detectObjectPollution(obj: any, objName: string = 'object'): boolean {
    console.log(`🔍 检测 ${objName} 的 amount 字段...`);
    
    if (!obj || typeof obj !== 'object') {
      console.log(`⚠️ ${objName} 不是有效对象`);
      return false;
    }

    const descriptor = Object.getOwnPropertyDescriptor(obj, 'amount');
    if (descriptor) {
      console.log(`❌ 发现 ${objName}.amount:`, {
        value: descriptor.value,
        getter: !!descriptor.get,
        setter: !!descriptor.set,
        writable: descriptor.writable,
        enumerable: descriptor.enumerable,
        configurable: descriptor.configurable
      });
      return true;
    }

    console.log(`✅ ${objName}.amount 未定义`);
    return false;
  }
}

// 导出便捷函数
export const detectAmountPollution = () => AmountPollutionDetector.getInstance().detectGlobalPollution();
export const quickDetectAmountPollution = () => AmountPollutionDetector.getInstance().quickDetect();
export const detectObjectAmountPollution = (obj: any, name?: string) => 
  AmountPollutionDetector.getInstance().detectObjectPollution(obj, name); 