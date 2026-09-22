// Test/build process preload only. Never imported by application code.
// Native network access stays blocked even when tests replace fetch with mocks.
const { syncBuiltinESMExports } = require('node:module');
const deny = () => { throw new Error('OFFLINE_VALIDATION_NETWORK_FORBIDDEN'); };
globalThis.fetch = deny;
require('node:net').Socket.prototype.connect = deny;
require('node:tls').connect = deny;
for (const name of ['node:http', 'node:https']) {
  require(name).request = deny;
  require(name).get = deny;
}
require('node:dgram').createSocket = deny;
require('node:dns').lookup = deny;
syncBuiltinESMExports();
