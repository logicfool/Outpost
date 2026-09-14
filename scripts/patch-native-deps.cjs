const fs = require('node:fs');
const path = require('node:path');

const gradle = path.join(
  __dirname,
  '..',
  'node_modules',
  '@react-native-cookies',
  'cookies',
  'android',
  'build.gradle',
);
if (fs.existsSync(gradle)) {
  const source = fs.readFileSync(gradle, 'utf8');
  const patched = source.replace(/\bjcenter\(\)/g, 'mavenCentral()');
  if (patched !== source) {
    fs.writeFileSync(gradle, patched);
    console.log('Patched jcenter() in @react-native-cookies/cookies');
  }
}

const tcp = path.join(
  __dirname,
  '..',
  'node_modules',
  'react-native-tcp-socket',
  'android',
  'src',
  'main',
  'java',
  'com',
  'asterinet',
  'react',
  'tcpsocket',
  'TcpSocketClient.java',
);
if (fs.existsSync(tcp)) {
  let source = fs.readFileSync(tcp, 'utf8');
  if (!source.includes('OUTPOST_TLS_HOST_VERIFICATION')) {
    const before = `        if (tlsOptions != null) {
            SSLSocketFactory ssf = getSSLSocketFactory(context, tlsOptions);
            socket = ssf.createSocket();
            ((SSLSocket) socket).setUseClientMode(true);
        } else {
            socket = new Socket();
        }`;
    const handshake =
      '        if (socket instanceof SSLSocket) ((SSLSocket) socket).startHandshake();';
    if (!source.includes(before) || !source.includes(handshake))
      throw new Error(
        'Review Android TLS hostname verification before building with the changed socket dependency.',
      );
    source = source.replace(before, '        socket = new Socket();');
    source = source.replace(
      handshake,
      `        if (tlsOptions != null) {
            // OUTPOST_TLS_HOST_VERIFICATION: DNS identity and SNI, not just chain trust.
            SSLSocketFactory ssf = getSSLSocketFactory(context, tlsOptions);
            SSLSocket tlsSocket = (SSLSocket) ssf.createSocket(socket, address, port, true);
            tlsSocket.setUseClientMode(true);
            javax.net.ssl.SSLParameters parameters = tlsSocket.getSSLParameters();
            parameters.setEndpointIdentificationAlgorithm("HTTPS");
            tlsSocket.setSSLParameters(parameters);
            socket = tlsSocket;
            tlsSocket.startHandshake();
        }`,
    );
    fs.writeFileSync(tcp, source);
    console.log('Applied Android TLS peer-host verification');
  }
}
