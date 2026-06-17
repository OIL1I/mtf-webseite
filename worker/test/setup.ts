// WebCrypto für password.ts bereitstellen, falls die Node-Version es nicht global hat.
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) {
  (globalThis as unknown as { crypto: Crypto }).crypto = webcrypto as unknown as Crypto;
}
