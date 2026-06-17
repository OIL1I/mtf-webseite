import { describe, expect, it } from 'vitest';
import { hashPassword, safeEqual, verifyPassword } from '../src/password';

describe('Passwort-Hashing', () => {
  it('verifiziert das korrekte Passwort und lehnt falsche ab', async () => {
    const hash = await hashPassword('geheim12345');
    expect(hash.startsWith('pbkdf2$')).toBe(true);
    expect(await verifyPassword('geheim12345', hash)).toBe(true);
    expect(await verifyPassword('falsch', hash)).toBe(false);
  });

  it('erzeugt unterschiedliche Hashes (zufälliges Salt)', async () => {
    expect(await hashPassword('gleich')).not.toBe(await hashPassword('gleich'));
  });

  it('lehnt kaputte Hash-Strings ab', async () => {
    expect(await verifyPassword('x', 'kein-gueltiger-hash')).toBe(false);
    expect(await verifyPassword('x', 'pbkdf2$100000$abc')).toBe(false);
  });
});

describe('safeEqual', () => {
  it('vergleicht inhaltsgleich', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
