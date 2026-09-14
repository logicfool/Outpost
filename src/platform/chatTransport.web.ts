import type { ChatTransport } from '../core/chatTypes';
import { AppError } from '../core/validation';
export const chatTransport: ChatTransport = () => {
  throw new AppError('NATIVE_REQUIRED', 'Riot chat requires a native mobile build.');
};
