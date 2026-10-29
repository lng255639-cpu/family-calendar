// 產生推播用的 VAPID 金鑰，輸出要設定到 Cloudflare 的值
import { webcrypto as crypto } from 'node:crypto';

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
const pub = Buffer.from(raw).toString('base64url');

console.log('VAPID_PUBLIC_KEY=' + pub);
console.log('VAPID_PRIVATE_JWK=' + JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }));
