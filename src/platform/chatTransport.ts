import { NativeModules } from 'react-native';
import TcpSocket from 'react-native-tcp-socket';
import { Buffer } from 'buffer';
import { AppError } from '../core/validation';
import type { ChatTransport } from '../core/chatTypes';

export const chatTransport: ChatTransport = (config, events) => {
  if (!/^[a-z0-9-]+\.chat\.si\.riotgames\.com$/.test(config.host) || config.port !== 5223)
    throw new AppError('CHAT_CONFIG', 'Untrusted chat server.');
  if (!NativeModules.TcpSockets)
    throw new AppError(
      'NATIVE_REQUIRED',
      'Install the updated native build to enable friends and chat.',
    );
  let closed = false,
    secure = false;
  const waiting = new Set<(error: Error) => void>();
  const options = {
    host: config.host,
    port: config.port,
    connectTimeout: 15000,
    rejectUnauthorized: true,
  };
  const socket = TcpSocket.connectTLS(options, () => {
    if (!closed) {
      secure = true;
      events.secure();
    }
  });
  const rejectWaiting = () => {
    for (const reject of [...waiting])
      reject(new AppError('CHAT_OFFLINE', 'The chat connection closed.'));
  };
  socket.on('data', (data) => {
    if (!closed && secure) events.data(typeof data === 'string' ? Buffer.from(data, 'utf8') : data);
  });
  socket.on('error', () => {
    if (!closed) {
      rejectWaiting();
      events.error();
    }
  });
  socket.on('close', () => {
    if (!closed) {
      closed = true;
      rejectWaiting();
      events.close();
    }
  });
  return {
    write(value) {
      if (closed || !secure)
        return Promise.reject(new AppError('CHAT_OFFLINE', 'The TLS handshake is not ready.'));
      return new Promise<void>((resolve, reject) => {
        const finish = (error?: Error | null) => {
          clearTimeout(timer);
          waiting.delete(fail);
          error
            ? reject(new AppError('CHAT_SEND', 'The chat write was not confirmed.'))
            : resolve();
        };
        const fail = (error: Error) => finish(error);
        const timer = setTimeout(() => finish(new Error('timeout')), 15000);
        waiting.add(fail);
        try {
          socket.write(value, 'utf8', finish);
        } catch {
          finish(new Error('write'));
        }
      });
    },
    close() {
      if (!closed) {
        closed = true;
        rejectWaiting();
        socket.destroy();
      }
    },
  };
};
