import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  buildIsolatedGitEnvironment,
} from '../../../../scripts/fulgor/corpus/materialization/gitProcess';

function nullDevice(): string {
  return process.platform ===
    'win32'
    ? 'NUL'
    : '/dev/null';
}

describe(
  'FULGOR Git process environment isolation',
  () => {
    it(
      'pins system/global Git configuration away from the host',
      () => {
        const environment =
          buildIsolatedGitEnvironment({
            PATH:
              'trusted-path',

            HOME:
              '/attacker/home',

            XDG_CONFIG_HOME:
              '/attacker/xdg',

            GIT_CONFIG_GLOBAL:
              '/attacker/global.gitconfig',

            GIT_CONFIG_SYSTEM:
              '/attacker/system.gitconfig',

            GIT_CONFIG_NOSYSTEM:
              '0',
          });

        expect(
          environment.PATH,
        ).toBe(
          'trusted-path',
        );

        expect(
          environment.GIT_CONFIG_NOSYSTEM,
        ).toBe(
          '1',
        );

        expect(
          environment.GIT_CONFIG_GLOBAL,
        ).toBe(
          nullDevice(),
        );

        expect(
          environment.GIT_CONFIG_SYSTEM,
        ).toBe(
          nullDevice(),
        );

        expect(
          environment.HOME,
        ).toBe(
          nullDevice(),
        );

        expect(
          environment.XDG_CONFIG_HOME,
        ).toBe(
          nullDevice(),
        );
      },
    );

    it(
      'removes direct Git config injection including url.insteadOf and credential redirects',
      () => {
        const environment =
          buildIsolatedGitEnvironment({
            GIT_CONFIG_PARAMETERS:
              "'url.https://evil.example/.insteadOf=https://github.com/' 'credential.helper=!evil'",

            GIT_CONFIG_COUNT:
              '2',

            GIT_CONFIG_KEY_0:
              'url.https://evil.example/.insteadOf',

            GIT_CONFIG_VALUE_0:
              'https://github.com/',

            GIT_CONFIG_KEY_1:
              'credential.helper',

            GIT_CONFIG_VALUE_1:
              '!evil',
          });

        expect(
          environment.GIT_CONFIG_PARAMETERS,
        ).toBeUndefined();

        expect(
          environment.GIT_CONFIG_KEY_0,
        ).toBeUndefined();

        expect(
          environment.GIT_CONFIG_VALUE_0,
        ).toBeUndefined();

        expect(
          environment.GIT_CONFIG_KEY_1,
        ).toBeUndefined();

        expect(
          environment.GIT_CONFIG_VALUE_1,
        ).toBeUndefined();

        expect(
          environment.GIT_CONFIG_COUNT,
        ).toBe(
          '0',
        );

        expect(
          JSON.stringify(
            environment,
          ),
        ).not.toContain(
          'evil.example',
        );

        expect(
          JSON.stringify(
            environment,
          ),
        ).not.toContain(
          '!evil',
        );
      },
    );

    it(
      'removes repository object and template redirection variables',
      () => {
        const environment =
          buildIsolatedGitEnvironment({
            SAFE_SENTINEL:
              'preserved',

            GIT_DIR:
              '/attacker/repository',

            GIT_WORK_TREE:
              '/attacker/worktree',

            GIT_COMMON_DIR:
              '/attacker/common',

            GIT_OBJECT_DIRECTORY:
              '/attacker/objects',

            GIT_ALTERNATE_OBJECT_DIRECTORIES:
              '/attacker/alternate',

            GIT_INDEX_FILE:
              '/attacker/index',

            GIT_NAMESPACE:
              'attacker',

            GIT_TEMPLATE_DIR:
              '/attacker/template',

            GIT_EXEC_PATH:
              '/attacker/bin',
          });

        expect(
          environment.SAFE_SENTINEL,
        ).toBe(
          'preserved',
        );

        for (
          const key of [
            'GIT_DIR',
            'GIT_WORK_TREE',
            'GIT_COMMON_DIR',
            'GIT_OBJECT_DIRECTORY',
            'GIT_ALTERNATE_OBJECT_DIRECTORIES',
            'GIT_INDEX_FILE',
            'GIT_NAMESPACE',
            'GIT_TEMPLATE_DIR',
            'GIT_EXEC_PATH',
          ]
        ) {
          expect(
            environment[key],
          ).toBeUndefined();
        }
      },
    );

    it(
      'removes hostile vectors case-insensitively before setting canonical values',
      () => {
        const environment =
          buildIsolatedGitEnvironment({
            git_config_global:
              'C:\\attacker\\.gitconfig',

            Git_Config_Parameters:
              "'http.extraHeader=Authorization: attacker'",

            git_config_key_7:
              'http.proxy',

            git_config_value_7:
              'https://evil.example',

            home:
              'C:\\attacker\\home',

            xdg_config_home:
              'C:\\attacker\\xdg',
          });

        const keys =
          Object.keys(
            environment,
          );

        expect(
          keys.some(
            (key) =>
              key ===
              'git_config_global',
          ),
        ).toBe(false);

        expect(
          keys.some(
            (key) =>
              key ===
              'Git_Config_Parameters',
          ),
        ).toBe(false);

        expect(
          keys.some(
            (key) =>
              key ===
              'git_config_key_7' ||
              key ===
              'git_config_value_7',
          ),
        ).toBe(false);

        expect(
          keys.some(
            (key) =>
              key ===
              'home' ||
              key ===
              'xdg_config_home',
          ),
        ).toBe(false);

        expect(
          environment.GIT_CONFIG_GLOBAL,
        ).toBe(
          nullDevice(),
        );

        expect(
          environment.GIT_CONFIG_COUNT,
        ).toBe(
          '0',
        );
      },
    );
  },
);
