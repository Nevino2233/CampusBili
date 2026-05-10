var Service = require('node-windows').Service;
var path = require('path');

var svc = new Service({
  name: 'CampusBili',
  description: 'CampusBili 校园哔哩哔哩代理服务器',
  script: path.join(__dirname, 'server.js'),
  nodeOptions: ['--harmony', '--max_old_space_size=4096'],
  env: [
    { name: 'NODE_ENV', value: 'production' },
    { name: 'PORT', value: '3003' }
  ]
});

svc.on('install', function() {
  console.log('[CampusBili] 服务安装成功');
  svc.start();
});

svc.on('start', function() {
  console.log('[CampusBili] 服务已启动，正在运行中...');
  console.log('[CampusBili] 访问地址: http://localhost:3003');
});

svc.on('error', function(err) {
  console.error('[CampusBili] 服务错误:', err);
});

svc.install();
