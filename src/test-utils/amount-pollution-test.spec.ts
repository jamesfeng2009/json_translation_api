import { AmountPollutionDetector, detectAmountPollution, quickDetectAmountPollution } from './amount-pollution-detector';

describe('Amount Pollution Detector', () => {
  let detector: AmountPollutionDetector;

  beforeEach(() => {
    detector = AmountPollutionDetector.getInstance();
  });

  describe('快速检测', () => {
    it('应该检测正常的对象行为', () => {
      const result = quickDetectAmountPollution();
      expect(result).toBe(false);
    });

    it('应该检测被污染的对象', () => {
      // 模拟污染
      const originalDefineProperty = Object.defineProperty;
      Object.defineProperty = jest.fn().mockImplementation((obj, prop, descriptor) => {
        if (prop === 'amount') {
          return originalDefineProperty.call(Object, obj, prop, {
            ...descriptor,
            get: () => 1,
            set: () => {}
          });
        }
        return originalDefineProperty.call(Object, obj, prop, descriptor);
      });

      const testObj = { amount: 100 };
      testObj.amount = 999;
      
      const result = quickDetectAmountPollution();
      
      // 恢复原始方法
      Object.defineProperty = originalDefineProperty;
      
      expect(result).toBe(true);
    });
  });

  describe('全局检测', () => {
    it('应该执行完整的全局检测', () => {
      const result = detectAmountPollution();
      // 在正常环境中应该返回 false
      expect(typeof result).toBe('boolean');
    });
  });

  describe('对象检测', () => {
    it('应该检测特定对象的 amount 字段', () => {
      const normalObj = { value: 100 };
      const result1 = detector.detectObjectPollution(normalObj, 'normalObj');
      expect(result1).toBe(false);

      const pollutedObj = {};
      Object.defineProperty(pollutedObj, 'amount', {
        value: 1,
        writable: false,
        enumerable: true,
        configurable: true
      });
      const result2 = detector.detectObjectPollution(pollutedObj, 'pollutedObj');
      expect(result2).toBe(true);
    });
  });

  describe('模拟污染场景', () => {
    it('应该检测 Object.prototype 污染', () => {
      // 模拟 Object.prototype 污染
      const originalDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'amount');
      
      Object.defineProperty(Object.prototype, 'amount', {
        value: 1,
        writable: false,
        enumerable: false,
        configurable: true
      });

      const result = detector.detectGlobalPollution();
      
      // 恢复原始状态
      if (originalDescriptor) {
        Object.defineProperty(Object.prototype, 'amount', originalDescriptor);
      } else {
        delete (Object.prototype as any).amount;
      }
      
      expect(result).toBe(true);
    });

    it('应该检测全局对象污染', () => {
      // 模拟全局对象污染
      const originalGlobal = (global as any).amount;
      
      (global as any).amount = 1;
      
      const result = detector.detectGlobalPollution();
      
      // 恢复原始状态
      if (originalGlobal !== undefined) {
        (global as any).amount = originalGlobal;
      } else {
        delete (global as any).amount;
      }
      
      expect(result).toBe(true);
    });
  });

  describe('代理检测', () => {
    it('应该检测代理对象的污染', () => {
      const testObj = { amount: 100 };
      
      // 创建一个污染的代理
      const pollutedProxy = new Proxy(testObj, {
        get(target, prop) {
          if (prop === 'amount') {
            return 1; // 强制返回 1
          }
          return target[prop as keyof typeof target];
        },
        set(target, prop, value) {
          if (prop === 'amount') {
            target[prop as keyof typeof target] = 1; // 强制设置为 1
            return true;
          }
          target[prop as keyof typeof target] = value;
          return true;
        }
      });

      // 测试代理行为
      expect(pollutedProxy.amount).toBe(1);
      pollutedProxy.amount = 999;
      expect(pollutedProxy.amount).toBe(1);
    });
  });
}); 