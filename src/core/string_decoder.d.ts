declare module 'string_decoder' {
  export class StringDecoder {
    constructor(encoding?: string);
    write(buffer: Uint8Array): string;
    end(buffer?: Uint8Array): string;
  }
}
