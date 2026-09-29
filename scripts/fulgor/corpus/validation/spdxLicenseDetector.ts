export type ReviewEligibleSpdxId =
  | 'MIT'
  | 'Apache-2.0'
  | 'BSD-2-Clause'
  | 'BSD-3-Clause'
  | 'ISC'
  | '0BSD'
  | 'CC0-1.0';

export type SpdxDetectionDecision =
  | 'DETECTED'
  | 'NO_MATCH'
  | 'AMBIGUOUS';

export interface SpdxLicenseDetection {
  decision:
    SpdxDetectionDecision;

  spdxId:
    ReviewEligibleSpdxId | null;
}

function normalizeLicenseText(
  input: string,
): string {
  return input
    .replace(
      /[\u2018\u2019]/g,
      "'",
    )
    .replace(
      /[\u201c\u201d]/g,
      '"',
    )
    .replace(
      /\s+/g,
      ' ',
    )
    .trim()
    .toLowerCase();
}

function includesAll(
  text: string,
  phrases: readonly string[],
): boolean {
  return phrases.every(
    (phrase) =>
      text.includes(
        phrase,
      ),
  );
}

function isApache20(
  text: string,
): boolean {
  return includesAll(
    text,
    [
      'apache license',
      'version 2.0, january 2004',
      'www.apache.org/licenses/',
      'terms and conditions for use, reproduction, and distribution',
      'software distributed under the license is distributed on an "as is" basis',
    ],
  );
}

function isMit(
  text: string,
): boolean {
  return includesAll(
    text,
    [
      'permission is hereby granted, free of charge, to any person obtaining a copy',
      'to deal in the software without restriction',
      'the software is provided "as is", without warranty of any kind',
      'in no event shall the authors or copyright holders be liable',
    ],
  );
}

function isBsd3Clause(
  text: string,
): boolean {
  return (
    includesAll(
      text,
      [
        'redistributions of source code must retain the above copyright notice',
        'redistributions in binary form must reproduce the above copyright notice',
        'neither the name',
        'nor the names of its contributors may be used to endorse or promote products derived from this software',
        'this software is provided by the copyright holders and contributors "as is"',
      ],
    )
  );
}

function isBsd2Clause(
  text: string,
): boolean {
  return (
    includesAll(
      text,
      [
        'redistributions of source code must retain the above copyright notice',
        'redistributions in binary form must reproduce the above copyright notice',
        'this software is provided by the copyright holders and contributors "as is"',
      ],
    ) &&
    !text.includes(
      'nor the names of its contributors may be used to endorse or promote products derived from this software',
    )
  );
}

const ISC_PERMISSION =
  'permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted';

const ISC_NOTICE =
  'provided that the above copyright notice and this permission notice appear in all copies';

const ISC_DISCLAIMER =
  'the software is provided "as is" and the author disclaims all warranties';

function isIsc(
  text: string,
): boolean {
  return includesAll(
    text,
    [
      ISC_PERMISSION,
      ISC_NOTICE,
      ISC_DISCLAIMER,
      'in no event shall the author be liable',
    ],
  );
}

function isZeroBsd(
  text: string,
): boolean {
  return (
    includesAll(
      text,
      [
        ISC_PERMISSION,
        ISC_DISCLAIMER,
        'in no event shall the author be liable',
      ],
    ) &&
    !text.includes(
      ISC_NOTICE,
    )
  );
}

function isCc0(
  text: string,
): boolean {
  return includesAll(
    text,
    [
      'cc0 1.0 universal',
      'statement of purpose',
      'copyright and related rights',
      'permanently, irrevocably and unconditionally',
      'waives, abandons, and surrenders',
    ],
  );
}

const DETECTORS:
  readonly [
    ReviewEligibleSpdxId,
    (
      text: string,
    ) => boolean,
  ][] = [
    [
      'Apache-2.0',
      isApache20,
    ],
    [
      'MIT',
      isMit,
    ],
    [
      'BSD-3-Clause',
      isBsd3Clause,
    ],
    [
      'BSD-2-Clause',
      isBsd2Clause,
    ],
    [
      'ISC',
      isIsc,
    ],
    [
      '0BSD',
      isZeroBsd,
    ],
    [
      'CC0-1.0',
      isCc0,
    ],
  ];

export function detectReviewEligibleSpdxLicense(
  licenseText: string,
): SpdxLicenseDetection {
  const normalized =
    normalizeLicenseText(
      licenseText,
    );

  if (
    normalized.length === 0
  ) {
    return {
      decision:
        'NO_MATCH',

      spdxId:
        null,
    };
  }

  const matches =
    DETECTORS
      .filter(
        ([
          ,
          detector,
        ]) =>
          detector(
            normalized,
          ),
      )
      .map(
        ([
          spdxId,
        ]) =>
          spdxId,
      );

  if (matches.length === 0) {
    return {
      decision:
        'NO_MATCH',

      spdxId:
        null,
    };
  }

  if (matches.length !== 1) {
    return {
      decision:
        'AMBIGUOUS',

      spdxId:
        null,
    };
  }

  return {
    decision:
      'DETECTED',

    spdxId:
      matches[0],
  };
}
