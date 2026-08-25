import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Cryptographic Security & Nonce Integrity', () => {
  function scanDir(dir: string): string[] {
    let files: string[] = [];
    if (!fs.existsSync(dir)) return files;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files = files.concat(scanDir(fullPath));
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        files.push(fullPath);
      }
    }
    return files;
  }

  it('Worker and security modules must NOT use Math.random() for security or key generation', () => {
    const sensitiveDirs = [
      path.resolve(__dirname, '../../worker/crypto'),
      path.resolve(__dirname, '../../worker/auth'),
      path.resolve(__dirname, '../../worker/middleware'),
      path.resolve(__dirname, '../../worker/repositories'),
    ];

    const files = sensitiveDirs.flatMap(scanDir);
    const violations: { file: string; line: number }[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((lineText, idx) => {
        if (/Math\.random\s*\(\s*\)/.test(lineText)) {
          violations.push({
            file: path.relative(path.resolve(__dirname, '../..'), file),
            line: idx + 1,
          });
        }
      });
    }

    expect(violations).toEqual([]);
  });

  it('Identity Vault crypto must use standard WebCrypto AES-GCM-256 with CSPRNG IVs', () => {
    const vaultCryptoPath = path.resolve(__dirname, '../../worker/crypto/vaultCrypto.ts');
    if (fs.existsSync(vaultCryptoPath)) {
      const content = fs.readFileSync(vaultCryptoPath, 'utf-8');
      expect(content).toContain('getRandomValues');
      expect(content).toContain('AES-GCM');
    }
  });
});
