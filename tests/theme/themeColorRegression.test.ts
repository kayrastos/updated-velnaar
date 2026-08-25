import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Theme Color Regression Suite', () => {
  function scanDir(dir: string): string[] {
    let files: string[] = [];
    if (!fs.existsSync(dir)) return files;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files = files.concat(scanDir(fullPath));
      } else if (entry.isFile() && (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts'))) {
        files.push(fullPath);
      }
    }
    return files;
  }

  it('No components or views should use banned hard-coded dark background/border hex classes', () => {
    const targetDirs = [
      path.resolve(__dirname, '../../src/components'),
      path.resolve(__dirname, '../../src/views'),
    ];

    const files = targetDirs.flatMap(scanDir);
    const bannedPatterns = [
      /bg-\[#0D0F15\]/i,
      /bg-\[#0F121A\]/i,
      /bg-\[#161922\]/i,
      /border-\[#232732\]/i,
      /border-\[#262B3A\]/i,
    ];

    const violations: { file: string; match: string }[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      for (const pattern of bannedPatterns) {
        if (pattern.test(content)) {
          violations.push({
            file: path.relative(path.resolve(__dirname, '../..'), file),
            match: pattern.source,
          });
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
