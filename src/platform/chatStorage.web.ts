import type { ChatStore } from '../core/chatStore';
import { AppError } from '../core/validation';
export async function openChatStorage(_id: string): Promise<ChatStore> {
  throw new AppError('NATIVE_REQUIRED', 'Real chat history is stored only in the native app.');
}
export async function removeChatStorage(_id: string): Promise<void> {}
