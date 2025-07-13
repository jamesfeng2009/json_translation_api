#!/usr/bin/env node

/**
 * 全局 amount 字段污染检测工具
 * 用于检测测试环境中 amount 字段是否被全局 getter/setter 污染
 */

console.log('🔍 开始检测 amount 字段污染...\n');

// 1. 检测全局对象上的 amount 属性
function checkGlobalAmount() {
  console.log('1. 检查全局对象上的 amount 属性:');
  
  const globalObjects = [
    'global',
    'window', 
    'self',
    'globalThis'
  ];
  
  globalObjects.forEach(objName => {
    try {
      const obj = eval(objName);
      if (obj && typeof obj === 'object') {
        const descriptor = Object.getOwnPropertyDescriptor(obj, 'amount');
        if (descriptor) {
          console.log(`   ❌ 发现 ${objName}.amount:`, {
            value: descriptor.value,
            getter: !!descriptor.get,
            setter: !!descriptor.set,
            writable: descriptor.writable,
            enumerable: descriptor.enumerable,
            configurable: descriptor.configurable
          });
        } else {
          console.log(`   ✅ ${objName}.amount 未定义`);
        }
      }
    } catch (e) {
      console.log(`   ⚠️  无法访问 ${objName}:`, e.message);
    }
  });
  console.log('');
}

// 2. 检测 Object.prototype 上的 amount
function checkObjectPrototype() {
  console.log('2. 检查 Object.prototype 上的 amount:');
  
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'amount');
  if (descriptor) {
    console.log('   ❌ 发现 Object.prototype.amount:', {
      value: descriptor.value,
      getter: !!descriptor.get,
      setter: !!descriptor.set,
      writable: descriptor.writable,
      enumerable: descriptor.enumerable,
      configurable: descriptor.configurable
    });
  } else {
    console.log('   ✅ Object.prototype.amount 未定义');
  }
  console.log('');
}

// 3. 检测常见原型链上的 amount
function checkCommonPrototypes() {
  console.log('3. 检查常见原型链上的 amount:');
  
  const prototypes = [
    { name: 'Array.prototype', obj: Array.prototype },
    { name: 'Object.prototype', obj: Object.prototype },
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
      console.log(`   ❌ 发现 ${name}.amount:`, {
        value: descriptor.value,
        getter: !!descriptor.get,
        setter: !!descriptor.set,
        writable: descriptor.writable,
        enumerable: descriptor.enumerable,
        configurable: descriptor.configurable
      });
    }
  });
  console.log('');
}

// 4. 检测 Jest 相关对象
function checkJestObjects() {
  console.log('4. 检查 Jest 相关对象:');
  
  const jestObjects = [
    'jest',
    'expect',
    'describe',
    'it',
    'test',
    'beforeEach',
    'afterEach',
    'beforeAll',
    'afterAll'
  ];
  
  jestObjects.forEach(objName => {
    try {
      const obj = eval(objName);
      if (obj && typeof obj === 'object') {
        const descriptor = Object.getOwnPropertyDescriptor(obj, 'amount');
        if (descriptor) {
          console.log(`   ❌ 发现 ${objName}.amount:`, {
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
      // Jest 对象可能不存在，忽略错误
    }
  });
  console.log('');
}

// 5. 检测模块缓存
function checkModuleCache() {
  console.log('5. 检查模块缓存:');
  
  if (typeof require !== 'undefined' && require.cache) {
    console.log('   检查 require.cache 中的模块...');
    let foundAmount = false;
    
    Object.keys(require.cache).forEach(modulePath => {
      const module = require.cache[modulePath];
      if (module && module.exports) {
        const descriptor = Object.getOwnPropertyDescriptor(module.exports, 'amount');
        if (descriptor) {
          console.log(`   ❌ 发现模块 ${modulePath} 的 exports.amount:`, {
            value: descriptor.value,
            getter: !!descriptor.get,
            setter: !!descriptor.set
          });
          foundAmount = true;
        }
      }
    });
    
    if (!foundAmount) {
      console.log('   ✅ require.cache 中未发现 amount 污染');
    }
  } else {
    console.log('   ⚠️ 无法访问 require.cache');
  }
  console.log('');
}

// 6. 检测当前作用域的变量
function checkCurrentScope() {
  console.log('6. 检查当前作用域变量:');
  
  try {
    // 尝试获取当前作用域的所有变量
    const vars = Object.keys(this || {});
    const amountVars = vars.filter(v => v.includes('amount'));
    
    if (amountVars.length > 0) {
      console.log(`   ⚠️ 发现包含 'amount' 的变量:`, amountVars);
    } else {
      console.log('   ✅ 当前作用域中未发现 amount 相关变量');
    }
  } catch (e) {
    console.log('   ⚠️ 无法检查当前作用域:', e.message);
  }
  console.log('');
}

// 7. 创建测试对象检测 getter/setter
function testAmountBehavior() {
  console.log('7. 测试 amount 字段行为:');
  
  const testObj = {
    amount: 100,
    amt: 200
  };
  
  console.log('   原始对象:', JSON.stringify(testObj));
  
  // 检查是否有 getter/setter
  const amountDescriptor = Object.getOwnPropertyDescriptor(testObj, 'amount');
  const amtDescriptor = Object.getOwnPropertyDescriptor(testObj, 'amt');
  
  console.log('   amount 描述符:', {
    value: amountDescriptor?.value,
    getter: !!amountDescriptor?.get,
    setter: !!amountDescriptor?.set,
    writable: amountDescriptor?.writable,
    enumerable: amountDescriptor?.enumerable,
    configurable: amountDescriptor?.configurable
  });
  
  console.log('   amt 描述符:', {
    value: amtDescriptor?.value,
    getter: !!amtDescriptor?.get,
    setter: !!amtDescriptor?.set,
    writable: amtDescriptor?.writable,
    enumerable: amtDescriptor?.enumerable,
    configurable: amtDescriptor?.configurable
  });
  
  // 尝试修改值
  try {
    testObj.amount = 999;
    testObj.amt = 888;
    console.log('   修改后对象:', JSON.stringify(testObj));
    
    if (testObj.amount !== 999) {
      console.log('   ❌ amount 值被意外修改!');
    } else {
      console.log('   ✅ amount 值正常');
    }
    
    if (testObj.amt !== 888) {
      console.log('   ❌ amt 值被意外修改!');
    } else {
      console.log('   ✅ amt 值正常');
    }
  } catch (e) {
    console.log('   ❌ 修改值时出错:', e.message);
  }
  console.log('');
}

// 8. 检测全局属性定义器
function checkGlobalPropertyDefiners() {
  console.log('8. 检查全局属性定义器:');
  
  const globalFunctions = [
    'Object.defineProperty',
    'Object.defineProperties',
    'Reflect.defineProperty'
  ];
  
  globalFunctions.forEach(funcName => {
    try {
      const func = eval(funcName);
      if (typeof func === 'function') {
        console.log(`   ✅ ${funcName} 可用`);
      }
    } catch (e) {
      console.log(`   ⚠️ ${funcName} 不可用:`, e.message);
    }
  });
  console.log('');
}

// 9. 检测可能的代理对象
function checkProxies() {
  console.log('9. 检查可能的代理对象:');
  
  const testObj = { amount: 100 };
  
  try {
    // 检查对象是否被代理
    const proxy = new Proxy(testObj, {
      get(target, prop) {
        if (prop === 'amount') {
          console.log('   ❌ 检测到 amount 属性的代理 getter');
          return 1; // 强制返回 1
        }
        return target[prop];
      },
      set(target, prop, value) {
        if (prop === 'amount') {
          console.log('   ❌ 检测到 amount 属性的代理 setter');
          target[prop] = 1; // 强制设置为 1
          return true;
        }
        target[prop] = value;
        return true;
      }
    });
    
    // 测试代理行为
    console.log('   测试代理对象:', proxy.amount);
    proxy.amount = 999;
    console.log('   设置后:', proxy.amount);
    
  } catch (e) {
    console.log('   ⚠️ 代理测试失败:', e.message);
  }
  console.log('');
}

// 10. 生成检测报告
function generateReport() {
  console.log('10. 检测报告:');
  console.log('   📊 检测完成');
  console.log('   💡 如果发现 amount 字段被污染，建议:');
  console.log('      1. 检查 Jest 配置文件');
  console.log('      2. 检查全局 mock 设置');
  console.log('      3. 检查测试环境变量');
  console.log('      4. 重启测试环境');
  console.log('      5. 清除 Jest 缓存');
  console.log('');
}

// 执行所有检测
function runAllChecks() {
  checkGlobalAmount();
  checkObjectPrototype();
  checkCommonPrototypes();
  checkJestObjects();
  checkModuleCache();
  checkCurrentScope();
  testAmountBehavior();
  checkGlobalPropertyDefiners();
  checkProxies();
  generateReport();
}

// 如果直接运行此脚本
if (require.main === module) {
  runAllChecks();
}

// 导出检测函数
module.exports = {
  runAllChecks,
  checkGlobalAmount,
  checkObjectPrototype,
  checkCommonPrototypes,
  checkJestObjects,
  checkModuleCache,
  checkCurrentScope,
  testAmountBehavior,
  checkGlobalPropertyDefiners,
  checkProxies,
  generateReport
}; 