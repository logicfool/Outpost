import { SaxesParser } from 'saxes';
import { StringDecoder } from 'string_decoder';
import { Buffer } from 'buffer';
import { AppError } from './validation';

export const NS = {
  client: 'jabber:client',
  stream: 'http://etherx.jabber.org/streams',
  sasl: 'urn:ietf:params:xml:ns:xmpp-sasl',
  bind: 'urn:ietf:params:xml:ns:xmpp-bind',
  session: 'urn:ietf:params:xml:ns:xmpp-session',
  roster: 'jabber:iq:riotgames:roster',
  ping: 'urn:xmpp:ping',
};
export interface XmlNode {
  name: string;
  ns: string;
  attrs: Record<string, string>;
  text: string;
  children: XmlNode[];
}
export const child = (node: XmlNode, name: string, ns?: string) =>
  node.children.find((n) => n.name === name && (!ns || n.ns === ns));
export function xmlEscape(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
}
export function messageText(value: string): string {
  const body = value.trim();
  const invalid = [...body].some((c) => {
    const p = c.codePointAt(0)!;
    return (
      (p < 32 && ![9, 10, 13].includes(p)) ||
      (p >= 0xd800 && p <= 0xdfff) ||
      p === 0xfffe ||
      p === 0xffff
    );
  });
  if (!body || [...body].length > 1000 || invalid)
    throw new AppError(
      'CHAT_MESSAGE',
      'Enter a message of 1-1,000 characters without invalid control characters.',
    );
  return body;
}

export class XmppXml {
  private parser!: SaxesParser<{ xmlns: true }>;
  private decoder = new StringDecoder('utf8');
  private stack: XmlNode[] = [];
  private budget = 0;
  private nodes = 0;
  private streamOpen = false;
  constructor(
    private stanza: (node: XmlNode) => void,
    private ended: () => void,
  ) {
    this.reset();
  }
  reset(): void {
    this.stack = [];
    this.budget = 0;
    this.nodes = 0;
    this.streamOpen = false;
    this.decoder = new StringDecoder('utf8');
    const parser = (this.parser = new SaxesParser({ xmlns: true }));
    parser.on('error', () => {
      throw new AppError('CHAT_XML', 'Riot chat returned malformed XML.');
    });
    parser.on('doctype', () => {
      throw new AppError('CHAT_XML', 'XML document declarations are not allowed in chat.');
    });
    parser.on('opentag', (tag) => {
      if (!this.streamOpen) {
        if (tag.local !== 'stream' || tag.uri !== NS.stream)
          throw new AppError('CHAT_XML', 'Expected an XMPP stream.');
        this.streamOpen = true;
        return;
      }
      if (tag.local === 'stream' && tag.uri === NS.stream)
        throw new AppError('CHAT_XML', 'Nested XMPP streams are not allowed.');
      if (
        ++this.nodes > 30000 ||
        this.stack.length >= 24 ||
        Object.keys(tag.attributes).length > 32
      )
        throw new AppError('CHAT_SIZE', 'Riot chat returned an oversized stanza.');
      const attrs: Record<string, string> = Object.create(null);
      for (const attr of Object.values(tag.attributes)) attrs[attr.name] = attr.value;
      this.stack.push({ name: tag.local, ns: tag.uri, attrs, text: '', children: [] });
    });
    const text = (value: string) => {
      const node = this.stack.at(-1);
      if (node) node.text += value;
    };
    parser.on('text', text);
    parser.on('cdata', text);
    parser.on('closetag', (tag) => {
      if (tag.local === 'stream' && tag.uri === NS.stream && !this.stack.length) {
        this.ended();
        return;
      }
      const node = this.stack.pop();
      if (!node) throw new AppError('CHAT_XML', 'Riot chat returned an invalid stanza boundary.');
      const parent = this.stack.at(-1);
      if (parent) parent.children.push(node);
      else {
        this.budget = 0;
        this.nodes = 0;
        this.stanza(node);
      }
    });
  }
  feed(bytes: Uint8Array): void {
    for (let offset = 0; offset < bytes.length; offset += 4096) {
      const chunk = bytes.subarray(offset, offset + 4096);
      this.budget += chunk.byteLength;
      if (this.budget > 2 * 1024 * 1024)
        throw new AppError('CHAT_SIZE', 'Riot chat returned an oversized stanza.');
      const decoded = this.decoder.write(Buffer.from(chunk));
      if (decoded) {
        let begin = 0;
        for (let end = decoded.indexOf('>'); end !== -1; end = decoded.indexOf('>', begin)) {
          this.parser.write(decoded.slice(begin, end + 1));
          begin = end + 1;
        }
        if (begin < decoded.length) this.parser.write(decoded.slice(begin));
      }
    }
  }
}

export const children = (node: XmlNode, name: string, ns?: string) =>
  node.children.filter((n) => n.name === name && (!ns || n.ns === ns));
export function parseJid(
  value: string,
): { subject: string; bare: string; resource: string } | undefined {
  const match =
    /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@([a-z0-9-]+\.pvp\.net)(?:\/([^\s<>"'&]{1,256}))?$/i.exec(
      value,
    );
  if (!match) return;
  return {
    subject: match[1]!.toLowerCase(),
    bare: `${match[1]}@${match[2]}`.toLowerCase(),
    resource: match[3] ?? '',
  };
}
