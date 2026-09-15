const https = require('https');

const paths = [
  '/',
  '/appcommon/user-profile',
  '/appcommon/externalfilter',
  '/api/externalfilter',
  '/api/master/externalfilter',
  '/api/user-profile'
];

paths.forEach(p => {
  const req = https.get(`https://polite-pond-09fb16200.7.azurestaticapps.net${p}`, res => {
    console.log(`PATH: ${p.padEnd(30)} -> STATUS: ${res.statusCode} | Content-Type: ${res.headers['content-type']}`);
  });
  req.on('error', e => console.error(p, e.message));
});
