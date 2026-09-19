export type ChatFilter = 'recent' | 'all' | 'online';
export interface ChatDirectoryView {
  filter: ChatFilter;
  query: string;
  offset: number;
}

export class ChatDirectoryMemory {
  private accountId?: string;
  private entries = new WeakMap<object, ChatDirectoryView>();
  forRoute(accountId: string | undefined, route: object): ChatDirectoryView {
    if (accountId !== this.accountId) {
      this.accountId = accountId;
      this.entries = new WeakMap();
    }
    let view = this.entries.get(route);
    if (!view) {
      view = { filter: 'recent', query: '', offset: 0 };
      this.entries.set(route, view);
    }
    return view;
  }
}
