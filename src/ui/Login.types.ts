import type { Account, LoginTokens, Region } from '../core/types';
export interface LoginProps {
  onClose(): void;
  onComplete(account: Account): void;
  presented: boolean;
  isActive?(): boolean;
  onBusyChange?(busy: boolean): void;
  onLink(tokens: LoginTokens, region?: Region, expectedId?: string): Promise<Account>;
  expectedId?: string;
}
