'use strict';

const http = require('node:http');
const request = http.get({host:'127.0.0.1', port:process.env.PORT || process.env.SERVER_PORT || 8080, path:'/healthz', timeout:2500}, response => {
  response.resume();
  process.exitCode = response.statusCode === 200 ? 0 : 1;
});
request.on('timeout', () => request.destroy(new Error('Readiness request timed out')));
request.on('error', () => { process.exitCode = 1; });
