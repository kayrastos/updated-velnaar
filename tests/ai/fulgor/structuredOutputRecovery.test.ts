import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  StructuredOutputRecoveryError,
  normalizeSingleJsonObject,
  parseRecovered,
} from '../../../worker/ai/fulgor/recovery/structuredOutputRecovery';

describe('Fulgor structuredOutputRecovery', () => {
  it('accepts plain JSON object', () => {
    const result =
      normalizeSingleJsonObject(
        '  {"status":"PASS","score":1}  ',
      );

    expect(result.envelope).toBe('plain_json');
    expect(result.value).toEqual({
      status: 'PASS',
      score: 1,
    });
  });

  it('unwraps exactly one lowercase json fence', () => {
    const result =
      normalizeSingleJsonObject(
        '```json\n{"status":"PASS"}\n```',
      );

    expect(result.envelope)
      .toBe('markdown_json_fence');

    expect(result.normalizedJson)
      .toBe('{"status":"PASS"}');
  });

  it('rejects malformed JSON', () => {
    expect(() =>
      normalizeSingleJsonObject(
        '{"status":"PASS",}',
      ),
    ).toThrow(StructuredOutputRecoveryError);
  });

  it('rejects an empty response', () => {
    expect(() =>
      normalizeSingleJsonObject('   '),
    ).toThrow(StructuredOutputRecoveryError);
  });

  it('rejects JSON arrays', () => {
    expect(() =>
      normalizeSingleJsonObject('[1,2,3]'),
    ).toThrow(
      'normalized JSON is not an object',
    );
  });

  it('rejects surrounding prose', () => {
    expect(() =>
      normalizeSingleJsonObject(
        'Here is the result: {"status":"PASS"}',
      ),
    ).toThrow(StructuredOutputRecoveryError);
  });

  it('rejects uppercase JSON Markdown fence', () => {
    expect(() =>
      normalizeSingleJsonObject(
        '```JSON\n{"status":"PASS"}\n```',
      ),
    ).toThrow(StructuredOutputRecoveryError);
  });

  it('does not weaken the downstream strict parser', () => {
    const parsed = parseRecovered(
      '{"status":"PASS"}',
      (json) => {
        const value = JSON.parse(json);

        if (
          value.status !== 'PASS' ||
          Object.keys(value).length !== 1
        ) {
          throw new Error('STRICT_SCHEMA_FAILURE');
        }

        return value.status as string;
      },
    );

    expect(parsed.parsed).toBe('PASS');

    expect(() =>
      parseRecovered(
        '{"status":"PASS","extra":true}',
        () => {
          throw new Error(
            'STRICT_SCHEMA_FAILURE',
          );
        },
      ),
    ).toThrow('STRICT_SCHEMA_FAILURE');
  });
});