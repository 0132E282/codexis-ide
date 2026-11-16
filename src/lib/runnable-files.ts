import { t } from '@/lib/i18n';
import type { ChangedFile } from '@/lib/ide';

/** A command that applies what a changed file holds (a migration, a seeder), with the label of its button. */
export type RunnableCommand = { label: string; command: string };

/** Reads a file of the project folder: its text, '' when it exists but cannot be read as text (binary, too large), undefined when it is missing. */
export type ProjectFileReader = (path: string) => Promise<string | undefined>;

/** The marker files of the project folder that were read, by path. */
type ProjectFiles = Map<string, string | undefined>;

/** What a command builder gets: the marker files and the way the project runs its Node tools (`npx`, `pnpm exec`...). */
type RuleContext = { files: ProjectFiles; nodeRunner: string };

/** One tool and one kind of file it applies: the files that show the tool is used, the changed paths it owns, and the command that applies them. */
type RunnableRule = {
    /** Files of the project folder read to know whether the tool is used. */
    markers: string[];
    isUsed: (files: ProjectFiles) => boolean;
    /** Matched against the path relative to the project folder. */
    path: RegExp;
    /** The Node tools are run through the project's package manager. */
    isNodeTool?: boolean;
    command: (
        match: RegExpExecArray,
        context: RuleContext,
    ) => RunnableCommand | null;
};

const NODE_LOCKFILES = [
    ['pnpm-lock.yaml', 'pnpm exec'],
    ['yarn.lock', 'yarn'],
    ['bun.lock', 'bunx'],
    ['bun.lockb', 'bunx'],
] as const;

/** Only names made of letters, digits, `_`, `.`, `-` and `/` go into a command, never a `..` segment or a leading `-`: nothing a shell would read as more than one word. */
function isSafeWord(value: string): boolean {
    return (
        /^[\w./-]+$/.test(value) &&
        !value.startsWith('-') &&
        !value.split('/').includes('..')
    );
}

const exists = (files: ProjectFiles, path: string) =>
    files.get(path) !== undefined;

const textOf = (files: ProjectFiles, path: string) => files.get(path) ?? '';

function parseJson(text: string): Record<string, unknown> {
    try {
        const parsed: unknown = JSON.parse(text);

        return typeof parsed === 'object' && parsed !== null
            ? (parsed as Record<string, unknown>)
            : {};
    } catch {
        // * A manifest that is not valid JSON names no dependency.
        return {};
    }
}

/** The package names a JSON manifest lists under the given sections (`dependencies`, `require`...). */
function jsonDependencies(text: string, sections: string[]): Set<string> {
    const manifest = parseJson(text);
    const names = new Set<string>();

    for (const section of sections) {
        const listed = manifest[section];

        if (typeof listed === 'object' && listed !== null) {
            Object.keys(listed).forEach((name) => names.add(name));
        }
    }

    return names;
}

const nodeDependsOn = (files: ProjectFiles, name: string) =>
    jsonDependencies(textOf(files, 'package.json'), [
        'dependencies',
        'devDependencies',
    ]).has(name);

const composerRequires = (files: ProjectFiles, name: string) =>
    jsonDependencies(textOf(files, 'composer.json'), [
        'require',
        'require-dev',
    ]).has(name);

/** A crate the root `Cargo.toml` depends on (`name = ...`, `name.workspace = true` or a `[dependencies.name]` table). */
const cargoDependsOn = (files: ProjectFiles, name: string) =>
    new RegExp(
        `^\\s*(${name}\\s*[=.]|\\[(dev-)?dependencies\\.${name}\\])`,
        'm',
    ).test(textOf(files, 'Cargo.toml'));

const migrate = (command: string): RunnableCommand => ({
    label: t('changed_files.run_migrations'),
    command,
});

const seedAll = (command: string): RunnableCommand => ({
    label: t('changed_files.run_seed'),
    command,
});

/** A command that seeds one named seeder (a file name is shown without its extension); skipped when the name is not safe in a command. */
function seedOne(name: string, command: string): RunnableCommand | null {
    return isSafeWord(name)
        ? {
              label: t('changed_files.run_seeder', {
                  name: name.replace(/\.\w+$/, ''),
              }),
              command,
          }
        : null;
}

/**
 * The PSR-4 class of a PHP file kept in a subfolder (`Geya/` → `Database\Seeders\Geya\Name`), single-quoted for the shell because of its backslashes.
 * Null when a segment is not a plain PHP name, so nothing but `\\w` ever goes inside the quotes.
 */
function quotedPhpClass(
    namespace: string,
    folder: string,
    name: string,
): string | null {
    const segments = [...folder.split('/').filter(Boolean), name];

    return segments.every((segment) => /^\w+$/.test(segment))
        ? `'${[namespace, ...segments].join('\\')}'`
        : null;
}

/** A seeder of a PHP framework: by its short name at the top of the seeders folder, by its full class in a subfolder. */
function phpSeeder(
    namespace: string,
    folder: string,
    name: string,
    command: (seederClass: string) => string,
): RunnableCommand | null {
    if (folder === '') {
        return seedOne(name, command(name));
    }

    const seederClass = quotedPhpClass(namespace, folder, name);

    return seederClass === null ? null : seedOne(name, command(seederClass));
}

const TYPEORM_DATA_SOURCES = [
    'src/data-source.ts',
    'src/data-source.js',
    'data-source.ts',
    'data-source.js',
    'src/database/data-source.ts',
    'src/config/data-source.ts',
    'src/db/data-source.ts',
];

const NODE_SCRIPT = '(?:js|cjs|mjs|ts)';

/** First matching rule wins for a file, so a more specific tool comes before a more general one sharing its folder. */
const RULES: RunnableRule[] = [
    // * PHP: Laravel.
    {
        markers: ['artisan'],
        isUsed: (files) => exists(files, 'artisan'),
        path: /^database\/migrations\/[^/]+\.php$/,
        command: () => migrate('php artisan migrate'),
    },
    {
        markers: ['artisan'],
        isUsed: (files) => exists(files, 'artisan'),
        path: /^database\/seeders\/((?:\w+\/)*)(\w+)\.php$/,
        command: ([, folder, name]) =>
            folder === '' && name === 'DatabaseSeeder'
                ? seedAll('php artisan db:seed')
                : phpSeeder(
                      'Database\\Seeders',
                      folder,
                      name,
                      (seederClass) =>
                          `php artisan db:seed --class=${seederClass}`,
                  ),
    },
    // * PHP: Symfony with Doctrine.
    {
        markers: ['composer.json'],
        isUsed: (files) =>
            composerRequires(files, 'doctrine/doctrine-migrations-bundle'),
        path: /^migrations\/Version\w+\.php$/,
        command: () =>
            migrate(
                'php bin/console doctrine:migrations:migrate --no-interaction',
            ),
    },
    {
        markers: ['composer.json'],
        isUsed: (files) =>
            composerRequires(files, 'doctrine/doctrine-fixtures-bundle'),
        path: /^src\/DataFixtures\/\w+\.php$/,
        command: () =>
            seedAll('php bin/console doctrine:fixtures:load --append'),
    },
    // * PHP: CodeIgniter 4.
    {
        markers: ['spark'],
        isUsed: (files) => exists(files, 'spark'),
        path: /^app\/Database\/Migrations\/[^/]+\.php$/,
        command: () => migrate('php spark migrate'),
    },
    {
        markers: ['spark'],
        isUsed: (files) => exists(files, 'spark'),
        // * `db:seed` takes a full class name too (one with a backslash is used as is), which a seeder in a subfolder needs.
        path: /^app\/Database\/Seeds\/((?:\w+\/)*)(\w+)\.php$/,
        command: ([, folder, name]) =>
            phpSeeder(
                'App\\Database\\Seeds',
                folder,
                name,
                (seederClass) => `php spark db:seed ${seederClass}`,
            ),
    },
    // * PHP: Yii 2 (basic and advanced templates).
    {
        markers: ['yii'],
        isUsed: (files) => exists(files, 'yii'),
        path: /^(?:console\/)?migrations\/m\d{6}_\d{6}_\w+\.php$/,
        command: () => migrate('php yii migrate --interactive=0'),
    },
    // * PHP: CakePHP migrations.
    {
        markers: ['composer.json'],
        isUsed: (files) => composerRequires(files, 'cakephp/migrations'),
        path: /^config\/Migrations\/[^/]+\.php$/,
        command: () => migrate('bin/cake migrations migrate'),
    },
    {
        markers: ['composer.json'],
        isUsed: (files) => composerRequires(files, 'cakephp/migrations'),
        path: /^config\/Seeds\/(\w+)\.php$/,
        command: ([, name]) =>
            seedOne(name, `bin/cake migrations seed --seed ${name}`),
    },
    // * PHP: Phinx on its own.
    {
        markers: ['composer.json'],
        isUsed: (files) => composerRequires(files, 'robmorgan/phinx'),
        path: /^db\/migrations\/\d+_\w+\.php$/,
        command: () => migrate('vendor/bin/phinx migrate'),
    },
    {
        markers: ['composer.json'],
        isUsed: (files) => composerRequires(files, 'robmorgan/phinx'),
        path: /^db\/seeds\/(\w+)\.php$/,
        command: ([, name]) =>
            seedOne(name, `vendor/bin/phinx seed:run -s ${name}`),
    },
    // * Ruby: Rails.
    {
        markers: ['Gemfile'],
        isUsed: (files) =>
            /^\s*gem\s+['"]rails['"]/m.test(textOf(files, 'Gemfile')),
        path: /^db\/migrate\/[^/]+\.rb$/,
        command: () => migrate('bin/rails db:migrate'),
    },
    {
        markers: ['Gemfile'],
        isUsed: (files) =>
            /^\s*gem\s+['"]rails['"]/m.test(textOf(files, 'Gemfile')),
        path: /^db\/seeds\.rb$/,
        command: () => seedAll('bin/rails db:seed'),
    },
    // * Python: Django (the migrations of any app; `__init__.py` has no number).
    {
        markers: ['manage.py'],
        isUsed: (files) => exists(files, 'manage.py'),
        path: /(?:^|\/)migrations\/\d{4}_[^/]*\.py$/,
        command: () => migrate('python manage.py migrate'),
    },
    // * Python: Alembic with its `alembic.ini` in the project folder.
    {
        markers: ['alembic.ini'],
        isUsed: (files) => exists(files, 'alembic.ini'),
        path: /^(?:[\w.-]+\/)*versions\/[^/]+\.py$/,
        command: () => migrate('alembic upgrade head'),
    },
    // * Python: Flask-Migrate (Alembic kept in `migrations/`).
    {
        markers: ['requirements.txt', 'pyproject.toml'],
        isUsed: (files) =>
            /flask[-_]migrate/i.test(
                textOf(files, 'requirements.txt') +
                    textOf(files, 'pyproject.toml'),
            ),
        path: /^migrations\/versions\/[^/]+\.py$/,
        command: () => migrate('flask db upgrade'),
    },
    // * Node: Prisma.
    {
        markers: ['package.json'],
        isUsed: (files) => nodeDependsOn(files, 'prisma'),
        path: /^prisma\/(?:schema\.prisma|migrations\/.+\/migration\.sql)$/,
        isNodeTool: true,
        command: (_match, { nodeRunner }) =>
            migrate(`${nodeRunner} prisma migrate dev`),
    },
    {
        markers: ['package.json'],
        isUsed: (files) => nodeDependsOn(files, 'prisma'),
        path: /^prisma\/seed\.(?:ts|js)$/,
        isNodeTool: true,
        command: (_match, { nodeRunner }) =>
            seedAll(`${nodeRunner} prisma db seed`),
    },
    // * Node: Drizzle (its default `drizzle/` output folder).
    {
        markers: ['package.json'],
        isUsed: (files) => nodeDependsOn(files, 'drizzle-kit'),
        path: /^drizzle\/\d{4}_[^/]+\.sql$/,
        isNodeTool: true,
        command: (_match, { nodeRunner }) =>
            migrate(`${nodeRunner} drizzle-kit migrate`),
    },
    // * Node: AdonisJS Lucid.
    {
        markers: ['package.json'],
        isUsed: (files) => nodeDependsOn(files, '@adonisjs/lucid'),
        path: new RegExp(`^database/migrations/[^/]+\\.${NODE_SCRIPT}$`),
        command: () => migrate('node ace migration:run'),
    },
    {
        markers: ['package.json'],
        isUsed: (files) => nodeDependsOn(files, '@adonisjs/lucid'),
        path: new RegExp(`^(database/seeders/([\\w.-]+)\\.${NODE_SCRIPT})$`),
        command: ([, path, name]) =>
            seedOne(name, `node ace db:seed --files ${path}`),
    },
    // * Node: TypeORM (needs its data source file, found at the usual places).
    {
        markers: ['package.json', ...TYPEORM_DATA_SOURCES],
        isUsed: (files) => nodeDependsOn(files, 'typeorm'),
        path: /(?:^|\/)migrations\/\d{13}-[\w-]+\.(?:ts|js)$/,
        isNodeTool: true,
        command: (_match, { files, nodeRunner }) => {
            const dataSource = TYPEORM_DATA_SOURCES.find((path) =>
                exists(files, path),
            );

            if (dataSource === undefined) {
                return null;
            }

            const cli = dataSource.endsWith('.ts')
                ? 'typeorm-ts-node-commonjs'
                : 'typeorm';

            return migrate(
                `${nodeRunner} ${cli} migration:run -d ${dataSource}`,
            );
        },
    },
    // * Node: MikroORM.
    {
        markers: ['package.json'],
        isUsed: (files) => nodeDependsOn(files, '@mikro-orm/migrations'),
        path: /^(?:src\/)?migrations\/Migration\d{14}\w*\.(?:ts|js)$/,
        isNodeTool: true,
        command: (_match, { nodeRunner }) =>
            migrate(`${nodeRunner} mikro-orm migration:up`),
    },
    {
        markers: ['package.json'],
        isUsed: (files) => nodeDependsOn(files, '@mikro-orm/seeder'),
        path: /^(?:src\/)?seeders\/(\w+)\.(?:ts|js)$/,
        isNodeTool: true,
        command: ([, name], { nodeRunner }) =>
            seedOne(name, `${nodeRunner} mikro-orm seeder:run --class=${name}`),
    },
    // * Node: Knex.
    {
        markers: ['package.json'],
        isUsed: (files) => nodeDependsOn(files, 'knex'),
        path: new RegExp(
            `^(?:src/)?(?:db/)?migrations/[^/]+\\.${NODE_SCRIPT}$`,
        ),
        isNodeTool: true,
        command: (_match, { nodeRunner }) =>
            migrate(`${nodeRunner} knex migrate:latest`),
    },
    {
        markers: ['package.json'],
        isUsed: (files) => nodeDependsOn(files, 'knex'),
        path: new RegExp(
            `^(?:src/)?(?:db/)?seeds/([\\w.-]+\\.${NODE_SCRIPT})$`,
        ),
        isNodeTool: true,
        command: ([, name], { nodeRunner }) =>
            seedOne(name, `${nodeRunner} knex seed:run --specific=${name}`),
    },
    // * Node: Sequelize (through its CLI).
    {
        markers: ['package.json'],
        isUsed: (files) => nodeDependsOn(files, 'sequelize-cli'),
        path: new RegExp(
            `^(?:src/)?(?:db/)?migrations/[^/]+\\.${NODE_SCRIPT}$`,
        ),
        isNodeTool: true,
        command: (_match, { nodeRunner }) =>
            migrate(`${nodeRunner} sequelize-cli db:migrate`),
    },
    {
        markers: ['package.json'],
        isUsed: (files) => nodeDependsOn(files, 'sequelize-cli'),
        path: new RegExp(
            `^(?:src/)?(?:db/)?seeders/([\\w.-]+\\.${NODE_SCRIPT})$`,
        ),
        isNodeTool: true,
        command: ([, name], { nodeRunner }) =>
            seedOne(name, `${nodeRunner} sequelize-cli db:seed --seed ${name}`),
    },
    // * Node: Kysely through kysely-ctl.
    {
        markers: ['package.json'],
        isUsed: (files) => nodeDependsOn(files, 'kysely-ctl'),
        path: new RegExp(
            `^(?:src/)?(?:db/)?migrations/[^/]+\\.${NODE_SCRIPT}$`,
        ),
        isNodeTool: true,
        command: (_match, { nodeRunner }) =>
            migrate(`${nodeRunner} kysely migrate:latest`),
    },
    // * Node: node-pg-migrate and db-migrate.
    {
        markers: ['package.json'],
        isUsed: (files) => nodeDependsOn(files, 'node-pg-migrate'),
        path: /^migrations\/[^/]+\.(?:js|cjs|mjs|ts|sql)$/,
        isNodeTool: true,
        command: (_match, { nodeRunner }) =>
            migrate(`${nodeRunner} node-pg-migrate up`),
    },
    {
        markers: ['package.json'],
        isUsed: (files) => nodeDependsOn(files, 'db-migrate'),
        path: /^migrations\/[^/]+\.js$/,
        isNodeTool: true,
        command: (_match, { nodeRunner }) =>
            migrate(`${nodeRunner} db-migrate up`),
    },
    // * dbmate (installed from npm or used by a Makefile).
    {
        markers: ['package.json', 'Makefile'],
        isUsed: (files) =>
            nodeDependsOn(files, 'dbmate') ||
            /\bdbmate\b/.test(textOf(files, 'Makefile')),
        path: /^db\/migrations\/\d+_[\w.-]+\.sql$/,
        isNodeTool: true,
        command: (_match, { files, nodeRunner }) =>
            migrate(
                nodeDependsOn(files, 'dbmate')
                    ? `${nodeRunner} dbmate up`
                    : 'dbmate up',
            ),
    },
    // * Go: goose (reads the database from `GOOSE_DRIVER` and `GOOSE_DBSTRING`).
    {
        markers: ['go.mod'],
        isUsed: (files) =>
            textOf(files, 'go.mod').includes('github.com/pressly/goose'),
        path: /^((?:[\w.-]+\/)*migrations)\/\d+_[\w.-]+\.(?:sql|go)$/,
        command: ([, folder]) =>
            isSafeWord(folder) ? migrate(`goose -dir ${folder} up`) : null,
    },
    // * Go: golang-migrate needs the database URL, so only a Makefile target that holds it is run.
    {
        markers: ['go.mod', 'Makefile'],
        isUsed: (files) =>
            textOf(files, 'go.mod').includes('golang-migrate/migrate') &&
            /^migrate(?:-up)?:/m.test(textOf(files, 'Makefile')),
        path: /^(?:db\/)?migrations\/\d+_[\w.-]+\.up\.sql$/,
        command: (_match, { files }) =>
            migrate(
                /^migrate-up:/m.test(textOf(files, 'Makefile'))
                    ? 'make migrate-up'
                    : 'make migrate',
            ),
    },
    // * Rust: Diesel, SQLx and SeaORM (the crate must be a dependency, so a project embedding its migrations, like this app, never matches).
    {
        markers: ['Cargo.toml'],
        isUsed: (files) => cargoDependsOn(files, 'diesel'),
        path: /^migrations\/[\w.-]+\/up\.sql$/,
        command: () => migrate('diesel migration run'),
    },
    {
        markers: ['Cargo.toml'],
        isUsed: (files) => cargoDependsOn(files, 'sqlx'),
        path: /^migrations\/\d+_[\w.-]+\.sql$/,
        command: () => migrate('sqlx migrate run'),
    },
    {
        markers: ['migration/Cargo.toml'],
        isUsed: (files) =>
            textOf(files, 'migration/Cargo.toml').includes('sea-orm-migration'),
        path: /^migration\/src\/m\d{8}_\d{6}_\w+\.rs$/,
        command: () => migrate('sea-orm-cli migrate up'),
    },
    // * Elixir: Ecto.
    {
        markers: ['mix.exs'],
        isUsed: (files) => textOf(files, 'mix.exs').includes(':ecto'),
        path: /^priv\/repo\/migrations\/\d+_\w+\.exs$/,
        command: () => migrate('mix ecto.migrate'),
    },
    {
        markers: ['mix.exs'],
        isUsed: (files) => textOf(files, 'mix.exs').includes(':ecto'),
        path: /^priv\/repo\/seeds\.exs$/,
        command: () => seedAll('mix run priv/repo/seeds.exs'),
    },
    // * JVM: Flyway and Liquibase through their Maven or Gradle plugin (a Spring app that migrates when it starts has neither).
    {
        markers: ['pom.xml', 'mvnw'],
        isUsed: (files) =>
            textOf(files, 'pom.xml').includes('flyway-maven-plugin'),
        path: /^src\/main\/resources\/db\/migration\/[^/]+\.sql$/,
        command: (_match, { files }) =>
            migrate(
                `${exists(files, 'mvnw') ? './mvnw' : 'mvn'} flyway:migrate`,
            ),
    },
    {
        markers: ['build.gradle', 'build.gradle.kts', 'gradlew'],
        isUsed: (files) =>
            /org\.flywaydb\.flyway/.test(
                textOf(files, 'build.gradle') +
                    textOf(files, 'build.gradle.kts'),
            ),
        path: /^src\/main\/resources\/db\/migration\/[^/]+\.sql$/,
        command: (_match, { files }) =>
            migrate(
                `${exists(files, 'gradlew') ? './gradlew' : 'gradle'} flywayMigrate`,
            ),
    },
    {
        markers: ['pom.xml', 'mvnw'],
        isUsed: (files) =>
            textOf(files, 'pom.xml').includes('liquibase-maven-plugin'),
        path: /^src\/main\/resources\/db\/changelog\/.+\.(?:xml|ya?ml|sql|json)$/,
        command: (_match, { files }) =>
            migrate(
                `${exists(files, 'mvnw') ? './mvnw' : 'mvn'} liquibase:update`,
            ),
    },
    {
        markers: ['build.gradle', 'build.gradle.kts', 'gradlew'],
        isUsed: (files) =>
            /org\.liquibase\.gradle/.test(
                textOf(files, 'build.gradle') +
                    textOf(files, 'build.gradle.kts'),
            ),
        path: /^src\/main\/resources\/db\/changelog\/.+\.(?:xml|ya?ml|sql|json)$/,
        command: (_match, { files }) =>
            migrate(
                `${exists(files, 'gradlew') ? './gradlew' : 'gradle'} update`,
            ),
    },
    // * .NET: Entity Framework Core (`<timestamp>_<Name>.cs`; the `.Designer.cs` beside it has a dot and is left out). The project folder is passed when it is not the root.
    {
        markers: [],
        isUsed: () => true,
        path: /^(?:(.+)\/)?Migrations\/\d{14}_\w+\.cs$/,
        command: ([, folder]) => {
            if (folder === undefined) {
                return migrate('dotnet ef database update');
            }

            return isSafeWord(folder)
                ? migrate(`dotnet ef database update --project ${folder}`)
                : null;
        },
    },
];

/** How the project runs its Node tools: the `packageManager` of `package.json`, else its lockfile, else `npx`. */
async function findNodeRunner(
    files: ProjectFiles,
    readFile: ProjectFileReader,
): Promise<string> {
    const manager = parseJson(textOf(files, 'package.json')).packageManager;

    if (typeof manager === 'string') {
        const name = manager.split('@')[0];
        const lockfile = NODE_LOCKFILES.find(([path]) => path.startsWith(name));

        if (lockfile !== undefined) {
            return lockfile[1];
        }

        if (name === 'npm') {
            return 'npx';
        }
    }

    for (const [path, runner] of NODE_LOCKFILES) {
        if ((await readFile(path)) !== undefined) {
            return runner;
        }
    }

    return 'npx';
}

/**
 * The commands the changed files ask for, once each (several migrations share one migrate command, each seeder has its own).
 * The tool is told by the project's own files (`artisan`, `package.json`, `go.mod`...), read through `readFile` only when a changed path could belong to a tool.
 * Deleted files ask for nothing; `stripPrefix` takes off the part of a path before the project folder (a worktree copy).
 */
export async function findRunnableCommands(
    changedFiles: ChangedFile[],
    stripPrefix: RegExp,
    readFile: ProjectFileReader,
): Promise<RunnableCommand[]> {
    const paths = changedFiles
        .filter((file) => file.status !== 'D')
        .map((file) => file.path.replace(stripPrefix, ''));
    const candidateRules = RULES.filter((rule) =>
        paths.some((path) => rule.path.test(path)),
    );

    if (candidateRules.length === 0) {
        return [];
    }

    const markers = [
        ...new Set(candidateRules.flatMap((rule) => rule.markers)),
    ];
    const files: ProjectFiles = new Map(
        await Promise.all(
            markers.map(async (path) => [path, await readFile(path)] as const),
        ),
    );
    const usedRules = candidateRules.filter((rule) => rule.isUsed(files));
    const nodeRunner = usedRules.some((rule) => rule.isNodeTool)
        ? await findNodeRunner(files, readFile)
        : 'npx';
    const commands = new Map<string, RunnableCommand>();

    for (const path of paths) {
        for (const rule of usedRules) {
            const match = rule.path.exec(path);

            if (match === null) {
                continue;
            }

            const runnable = rule.command(match, { files, nodeRunner });

            if (runnable !== null && !commands.has(runnable.command)) {
                commands.set(runnable.command, runnable);
            }

            break;
        }
    }

    return [...commands.values()];
}
