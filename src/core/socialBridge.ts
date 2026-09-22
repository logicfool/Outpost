import { loginDocument } from './socialLogin';
import { AppError } from './validation';
function key(value: string): string {
  if (!/^[a-f0-9]{32,128}$/.test(value))
    throw new AppError('SOCIAL_BRIDGE', 'Invalid sign-in bridge.');
  return value;
}
/** Delegates popup navigation only. Never reads form inputs, passwords or browser cookies. */
export function socialPopupBridge(nonce: string): string {
  const id = JSON.stringify(key(nonce));
  return `(function(){
    if(window!==window.top||!['auth.riotgames.com','authenticate.riotgames.com','login.riotgames.com'].includes(location.hostname)||location.protocol!=='https:')return;
    const key=${id};if(window.__outpostSocialBridge===key)return;window.__outpostSocialBridge=key;
    const handles=[];
    const send=url=>{if(!url||url==='about:blank')return;try{const target=new URL(String(url),location.href).href;window.ReactNativeWebView.postMessage(JSON.stringify({type:'outpost-social-popup',key,url:target}));}catch{}};
    window.open=function(url){
      let closed=false,href='about:blank';
      const locationProxy={assign:send,replace:send};
      Object.defineProperty(locationProxy,'href',{get:()=>href,set:value=>{href=String(value);send(href);}});
      const handle={focus(){},close(){closed=true;}};
      Object.defineProperty(handle,'closed',{get:()=>closed});
      Object.defineProperty(handle,'location',{get:()=>locationProxy,set:value=>{href=String(value);send(href);}});
      handles.push(handle);if(handles.length>5)handles.shift();send(url);return handle;
    };
    window.__outpostCloseSocialPopups=function(value){if(value===key)for(const handle of handles)handle.close();};
  })();true;`;
}
export function socialStatusProbe(nonce: string, probeId: string): string {
  if (!/^\d+:\d+$/.test(probeId)) throw new AppError('SOCIAL_BRIDGE', 'Invalid sign-in check.');
  return `(async function(){
    const key=${JSON.stringify(key(nonce))},id=${JSON.stringify(probeId)};
    const send=value=>window.ReactNativeWebView.postMessage(JSON.stringify({type:'outpost-social-status',key,id,...value}));
    if(window!==window.top||location.origin!=='https://authenticate.riotgames.com'){send({status:'unavailable'});return;}
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),7500);
    try{
      const response=await fetch('/api/v1/login',{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal:controller.signal,headers:{Accept:'application/json'}});
      if(!response.ok){const header=response.headers.get('retry-after'),seconds=header&&/^\\d+$/.test(header)?Number(header):header&&Number.isFinite(Date.parse(header))?Math.max(0,Math.ceil((Date.parse(header)-Date.now())/1000)):undefined;controller.abort();send({status:'unavailable',http:response.status,retrySeconds:seconds});return;}
      const advertised=response.headers.get('content-length');
      if(advertised&&/^\\d+$/.test(advertised)&&Number(advertised)>65536){controller.abort();send({status:'unavailable',http:response.status});return;}
      if(!response.body?.getReader){controller.abort();send({status:'unavailable',http:response.status});return;}
      const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let text='',bytes=0;
      try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>65536){await reader.cancel();controller.abort();send({status:'unavailable',http:response.status});return;}text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
      const value=JSON.parse(text);
      if(value.type==='success'&&typeof value.success?.redirect_url==='string')send({status:'success',http:response.status,url:value.success.redirect_url});
      else if(['multifactor','signup','healup','linking','parental_consent','verification','confirm_age','id_verification','kr-id-verification','re-auth'].includes(value.type))send({status:'interaction',http:response.status});
      else send({status:value.type==='error'?'unavailable':'pending',http:response.status});
    }catch{send({status:'unavailable'});}finally{clearTimeout(timeout);}
  })();true;`;
}
export type SocialBridgeMessage =
  | { type: 'outpost-social-popup'; url: string }
  | {
      type: 'outpost-social-status';
      id: string;
      status: string;
      url?: string;
      http?: number;
      retrySeconds?: number;
    };
export function parseSocialBridgeMessage(
  raw: string,
  source: string,
  nonce: string,
): SocialBridgeMessage | undefined {
  if (!loginDocument(source) || typeof raw !== 'string' || raw.length > 49152 || !nonce) return;
  try {
    const m = JSON.parse(raw);
    if (!m || m.key !== nonce) return;
    if (m.type === 'outpost-social-popup' && typeof m.url === 'string' && m.url.length <= 32768)
      return { type: m.type, url: m.url };
    if (
      new URL(source).origin !== 'https://authenticate.riotgames.com' ||
      m.type !== 'outpost-social-status' ||
      typeof m.id !== 'string' ||
      !/^\d+:\d+$/.test(m.id) ||
      !['pending', 'success', 'interaction', 'unavailable'].includes(m.status)
    )
      return;
    if (m.http !== undefined && (!Number.isInteger(m.http) || m.http < 100 || m.http > 599)) return;
    if (m.retrySeconds !== undefined && (!Number.isFinite(m.retrySeconds) || m.retrySeconds < 0))
      return;
    if (m.url !== undefined && (typeof m.url !== 'string' || m.url.length > 32768)) return;
    return {
      type: m.type,
      id: m.id,
      status: m.status,
      url: m.url,
      http: typeof m.http === 'number' ? m.http : undefined,
      retrySeconds: typeof m.retrySeconds === 'number' ? m.retrySeconds : undefined,
    };
  } catch {
    return;
  }
}
