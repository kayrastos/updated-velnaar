import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Architectural Boundary Enforcement', () => {
  function scanDir(dir: string): string[] {
    let files: string[] = [];
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

  it('Frontend src/ MUST NOT import worker/* directly', () => {
    const srcDir = path.resolve(__dirname, '../../src');
    const srcFiles = scanDir(srcDir);
    const violations: string[] = [];

    const workerImportRegex = /from\s+['"][^'"]*worker\/[^'"]*['"]/g;

    for (const file of srcFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      if (workerImportRegex.test(content)) {
        violations.push(file);
      }
    }

    expect(violations).toEqual([]);
  });
});
