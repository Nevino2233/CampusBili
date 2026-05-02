var Service = require('node-windows').Service;
var path = require('path');

var svc = new Service({
  name: 'CampusBili',
  script: path.join(__dirname, 'server.js')
});

svc.on('uninstall', function() {
  console.log('[CampusBili] 服务已卸载');
});

svc.on('stop', function() {
  console.log('[CampusBili] 服务已停止');
});

svc.on('error', function(err) {
  console.error('[CampusBili] 服务错误:', err);
});

svc.uninstall();
