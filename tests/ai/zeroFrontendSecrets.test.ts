import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Sprint 4 - Zero Frontend Secrets & Server-Side Security Invariants', () => {
  const srcDir = path.resolve(__dirname, '../../src');

  function scanDirectory(dir: string, fileList: string[] = []): string[] {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        scanDirectory(fullPath, fileList);
      } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
        fileList.push(fullPath);
      }
    }
    return fileList;
  }

  it('ensures frontend src/ contains NO provider API keys or secret tokens', () => {
    const allFrontendFiles = scanDirectory(srcDir);
    const forbiddenPatterns = [
      /GEMINI_API_KEY\s*[:=]\s*['"][^'"]+['"]/i,
      /DEEPSEEK_API_KEY\s*[:=]\s*['"][^'"]+['"]/i,
      /KIMI_API_KEY\s*[:=]\s*['"][^'"]+['"]/i,
      /AIzaSy[a-zA-Z0-9_-]{33}/,
      /sk-[a-zA-Z0-9]{20,}/,
      /sec_[a-zA-Z0-9_-]{16,}/,
    ];

    for (const file of allFrontendFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      for (const pattern of forbiddenPatterns) {
        expect(pattern.test(content)).toBe(false);
      }
    }
  });

  it('ensures deprecated mock src/services/aiGateway.ts does not exist', () => {
    const deprecatedPath = path.resolve(srcDir, 'services/aiGateway.ts');
    expect(fs.existsSync(deprecatedPath)).toBe(false);
  });

  it('ensures server-side AI architecture files exist in worker/ai/', () => {
    const workerAiDir = path.resolve(__dirname, '../../worker/ai');
    expect(fs.existsSync(path.join(workerAiDir, 'types.ts'))).toBe(true);
    expect(fs.existsSync(path.join(workerAiDir, 'aiRouter.ts'))).toBe(true);
    expect(fs.existsSync(path.join(workerAiDir, 'dataClassifier.ts'))).toBe(true);
    expect(fs.existsSync(path.join(workerAiDir, 'redaction.ts'))).toBe(true);
    expect(fs.existsSync(path.join(workerAiDir, 'budgetManager.ts'))).toBe(true);
    expect(fs.existsSync(path.join(workerAiDir, 'promptRegistry.ts'))).toBe(true);
    expect(fs.existsSync(path.join(workerAiDir, 'outputValidator.ts'))).toBe(true);
    expect(fs.existsSync(path.join(workerAiDir, 'actions/actionPolicyEngine.ts'))).toBe(true);
  });
});
