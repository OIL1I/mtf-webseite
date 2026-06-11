// Erzeugt ein VAPID-Schlüsselpaar für Web-Push.
// Aufruf: npm run vapid (im Ordner worker/)
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
const publicKey = Buffer.from(raw).toString('base64url');

console.log('VAPID-Schlüssel erzeugt.\n');
console.log('1) In wrangler.toml unter [vars] eintragen:');
console.log(`   VAPID_PUBLIC_KEY = "${publicKey}"\n`);
console.log('2) Als Secret setzen (Befehl ausführen und den JSON-Wert einfügen):');
console.log('   wrangler secret put VAPID_PRIVATE_JWK');
console.log(`   ${JSON.stringify(jwk)}\n`);
console.log('Den privaten Schlüssel niemals committen oder weitergeben.');
