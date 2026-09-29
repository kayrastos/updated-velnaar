import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  detectReviewEligibleSpdxLicense,
} from '../../../../scripts/fulgor/corpus/validation/spdxLicenseDetector';

describe(
  'FULGOR autonomous SPDX detector',
  () => {
    it(
      'detects Apache-2.0 from material license language',
      () => {
        const result =
          detectReviewEligibleSpdxLicense(
            `
            Apache License
            Version 2.0, January 2004
            http://www.apache.org/licenses/

            TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

            Unless required by applicable law or agreed to in writing,
            software distributed under the License is distributed on an
            "AS IS" BASIS.
            `,
          );

        expect(result)
          .toEqual({
            decision:
              'DETECTED',

            spdxId:
              'Apache-2.0',
          });
      },
    );

    it(
      'detects MIT',
      () => {
        const result =
          detectReviewEligibleSpdxLicense(
            `
            Permission is hereby granted, free of charge, to any person obtaining a copy
            of this software to deal in the Software without restriction.

            THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
            IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE.
            `,
          );

        expect(result.spdxId)
          .toBe('MIT');
      },
    );

    it(
      'detects BSD-3-Clause',
      () => {
        const result =
          detectReviewEligibleSpdxLicense(
            `
            Redistributions of source code must retain the above copyright notice.
            Redistributions in binary form must reproduce the above copyright notice.

            Neither the name of Example nor the names of its contributors may be used
            to endorse or promote products derived from this software.

            THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS".
            `,
          );

        expect(result.spdxId)
          .toBe(
            'BSD-3-Clause',
          );
      },
    );

    it(
      'detects BSD-2-Clause without confusing it with BSD-3-Clause',
      () => {
        const result =
          detectReviewEligibleSpdxLicense(
            `
            Redistributions of source code must retain the above copyright notice.
            Redistributions in binary form must reproduce the above copyright notice.
            THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS".
            `,
          );

        expect(result.spdxId)
          .toBe(
            'BSD-2-Clause',
          );
      },
    );

    it(
      'detects ISC',
      () => {
        const result =
          detectReviewEligibleSpdxLicense(
            `
            Permission to use, copy, modify, and/or distribute this software for any
            purpose with or without fee is hereby granted, provided that the above
            copyright notice and this permission notice appear in all copies.

            THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES.
            IN NO EVENT SHALL THE AUTHOR BE LIABLE.
            `,
          );

        expect(result.spdxId)
          .toBe('ISC');
      },
    );

    it(
      'detects 0BSD only when the ISC copyright-retention condition is absent',
      () => {
        const result =
          detectReviewEligibleSpdxLicense(
            `
            Permission to use, copy, modify, and/or distribute this software for any
            purpose with or without fee is hereby granted.

            THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES.
            IN NO EVENT SHALL THE AUTHOR BE LIABLE.
            `,
          );

        expect(result.spdxId)
          .toBe('0BSD');
      },
    );

    it(
      'detects CC0-1.0 conservatively',
      () => {
        const result =
          detectReviewEligibleSpdxLicense(
            `
            Creative Commons Legal Code
            CC0 1.0 Universal

            Statement of Purpose

            Copyright and Related Rights.

            The Affirmer permanently, irrevocably and unconditionally
            waives, abandons, and surrenders these rights.
            `,
          );

        expect(result.spdxId)
          .toBe('CC0-1.0');
      },
    );

    it(
      'does not trust an SPDX-looking label alone',
      () => {
        const result =
          detectReviewEligibleSpdxLicense(
            'License: Apache-2.0',
          );

        expect(result)
          .toEqual({
            decision:
              'NO_MATCH',

            spdxId:
              null,
          });
      },
    );

    it(
      'fails closed for unknown licenses',
      () => {
        const result =
          detectReviewEligibleSpdxLicense(
            'Custom proprietary terms.',
          );

        expect(result.spdxId)
          .toBeNull();
      },
    );

    it(
      'fails closed when multiple deterministic signatures are present',
      () => {
        const result =
          detectReviewEligibleSpdxLicense(
            `
            Permission is hereby granted, free of charge, to any person obtaining a copy
            to deal in the Software without restriction.
            THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
            IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE.

            Permission to use, copy, modify, and/or distribute this software for any
            purpose with or without fee is hereby granted, provided that the above
            copyright notice and this permission notice appear in all copies.
            THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES.
            IN NO EVENT SHALL THE AUTHOR BE LIABLE.
            `,
          );

        expect(result)
          .toEqual({
            decision:
              'AMBIGUOUS',

            spdxId:
              null,
          });
      },
    );
  },
);
