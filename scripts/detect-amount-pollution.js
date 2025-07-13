#!/usr/bin/env node

/**
 * Amount 字段污染检测脚本
 * 使用方法: node scripts/detect-amount-pollution.js
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Amount 字段污染检测工具');
console.log('========================\n');

// 检测函数
function checkGlobalAmount() {
  console.log('1. 检查全局对象上的 amount 属性:');
  
  const globalObjects = ['global', 'window', 'self', 'globalThis'];
  
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

function checkJestObjects() {
  console.log('4. 检查 Jest 相关对象:');
  
  const jestObjects = [
    'jest', 'expect', 'describe', 'it', 'test',
    'beforeEach', 'afterEach', 'beforeAll', 'afterAll'
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

function testAmountBehavior() {
  console.log('6. 测试 amount 字段行为:');
  
  const testObj = {
    amount: 100,
    amt: 200,
    value: 300
  };
  
  console.log('   原始对象:', JSON.stringify(testObj));
  
  // 检查描述符
  const amountDescriptor = Object.getOwnPropertyDescriptor(testObj, 'amount');
  const amtDescriptor = Object.getOwnPropertyDescriptor(testObj, 'amt');
  const valueDescriptor = Object.getOwnPropertyDescriptor(testObj, 'value');
  
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
  
  console.log('   value 描述符:', {
    value: valueDescriptor?.value,
    getter: !!valueDescriptor?.get,
    setter: !!valueDescriptor?.set,
    writable: valueDescriptor?.writable,
    enumerable: valueDescriptor?.enumerable,
    configurable: valueDescriptor?.configurable
  });
  
  // 尝试修改值
  try {
    testObj.amount = 999;
    testObj.amt = 888;
    testObj.value = 777;
    
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
    
    if (testObj.value !== 777) {
      console.log('   ❌ value 值被意外修改!');
    } else {
      console.log('   ✅ value 值正常');
    }
  } catch (e) {
    console.log('   ❌ 修改值时出错:', e.message);
  }
  console.log('');
}

function checkJestConfig() {
  console.log('7. 检查 Jest 配置文件:');
  
  const jestConfigFiles = [
    'jest.config.js',
    'jest.config.ts',
    'jest.config.json',
    'package.json'
  ];
  
  jestConfigFiles.forEach(file => {
    try {
      const filePath = path.resolve(process.cwd(), file);
      if (fs.existsSync(filePath)) {
        console.log(`   检查 ${file}...`);
        
        if (file === 'package.json') {
          const pkg = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          if (pkg.jest) {
            console.log(`   📄 发现 package.json 中的 Jest 配置`);
            // 检查是否有全局设置
            if (pkg.jest.setupFilesAfterEnv) {
              console.log(`   📄 setupFilesAfterEnv:`, pkg.jest.setupFilesAfterEnv);
            }
            if (pkg.jest.globals) {
              console.log(`   📄 globals:`, pkg.jest.globals);
            }
          }
        } else {
          const content = fs.readFileSync(filePath, 'utf8');
          if (content.includes('amount')) {
            console.log(`   ⚠️  ${file} 中包含 'amount' 关键字`);
          }
          if (content.includes('Object.defineProperty')) {
            console.log(`   ⚠️  ${file} 中包含 'Object.defineProperty'`);
          }
          if (content.includes('Proxy')) {
            console.log(`   ⚠️  ${file} 中包含 'Proxy'`);
          }
        }
      }
    } catch (e) {
      console.log(`   ⚠️  无法读取 ${file}:`, e.message);
    }
  });
  console.log('');
}

function checkEnvironmentVariables() {
  console.log('8. 检查环境变量:');
  
  const envVars = Object.keys(process.env);
  const amountRelatedVars = envVars.filter(v => v.toLowerCase().includes('amount'));
  
  if (amountRelatedVars.length > 0) {
    console.log('   ⚠️  发现与 amount 相关的环境变量:');
    amountRelatedVars.forEach(v => {
      console.log(`     ${v}=${process.env[v]}`);
    });
  } else {
    console.log('   ✅ 未发现与 amount 相关的环境变量');
  }
  console.log('');
}

function generateReport() {
  console.log('📊 检测报告:');
  console.log('   💡 如果发现 amount 字段被污染，建议:');
  console.log('      1. 检查 Jest 配置文件 (jest.config.js)');
  console.log('      2. 检查全局 mock 设置');
  console.log('      3. 检查测试环境变量');
  console.log('      4. 重启测试环境');
  console.log('      5. 清除 Jest 缓存: npm run test -- --clearCache');
  console.log('      6. 检查是否有全局的 Object.defineProperty 调用');
  console.log('      7. 检查是否有全局的 Proxy 设置');
  console.log('      8. 检查测试设置文件 (setupFilesAfterEnv)');
  console.log('');
}

// 执行所有检测
function runAllChecks() {
  checkGlobalAmount();
  checkObjectPrototype();
  checkCommonPrototypes();
  checkJestObjects();
  checkModuleCache();
  testAmountBehavior();
  checkJestConfig();
  checkEnvironmentVariables();
  generateReport();
}

// 如果直接运行此脚本
if (require.main === module) {
  runAllChecks();
}

module.exports = {
  runAllChecks,
  checkGlobalAmount,
  checkObjectPrototype,
  checkCommonPrototypes,
  checkJestObjects,
  checkModuleCache,
  testAmountBehavior,
  checkJestConfig,
  checkEnvironmentVariables,
  generateReport
}; 