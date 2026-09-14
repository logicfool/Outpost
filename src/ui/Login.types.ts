import type { LoginTokens, Region } from '../core/types';
export interface LoginProps {
  onClose(): void;
  onLink(tokens: LoginTokens, region?: Region, expectedId?: string): Promise<void>;
  expectedId?: string;
}
