/**
Minimal flag parsing for the operator scripts.

Provenance: ported from Edge-Sonic's `scripts/lib/cli-args.ts`, which is the
only typed arg parser in the family — every other repo reads `process.argv`
with `includes('--flag')` inline.

The shape is generic: a declared set of value flags and boolean flags, so an
unknown or valueless flag is rejected **by name** rather than silently ignored.
A mistyped `--write` must not degrade into "ran with no flags" — which is what
an inline `argv.includes()` does, and what turns a migration-lock invocation
that misspelled the flag into a read-only run that reports success.

Usage:

```ts
const flags = parseFlags(process.argv.slice(2), {
  boolean: ['write', 'dry-run'],
  value: ['locales-dir', 'root'],
});
if (isSet(flags, 'write')) { ... }
const dir = valueOf(flags, 'locales-dir');
```
*/

/**
Parsed flags: value flags map to their string, boolean flags to `true`.
*/
export type ParsedFlags = Map<string, string | true>;

/**
Declares which flags take a value and which are bare switches.
*/
export interface FlagSpec {
  /**
  `--name` takes a value, e.g. `--to new@example.com`.
  */
  value?: readonly string[];
  /**
  `--dry-run` takes no value.
  */
  boolean?: readonly string[];
  /**
  Short form → long form, e.g. `{ h: 'help' }`.
  */
  alias?: Readonly<Record<string, string>>;
}

/**
Parses `--flag value` and `--boolean` pairs out of `argv`.

@throws when a value flag is missing its value, when a flag is repeated, or
  when an undeclared flag is seen. Each case names the offending flag.
*/
export function parseFlags(argv: readonly string[], spec: FlagSpec): ParsedFlags {
  const valueFlags = new Set(spec.value);
  const booleanFlags = new Set(spec.boolean);
  const aliases = spec.alias ?? {};
  const flags: ParsedFlags = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    // `?? ''` rather than `as string`. `argv[index]` is `string | undefined` under
    // `noUncheckedIndexedAccess`, which this package's own tsconfig does not enable
    // and a consuming repo's does — so an assertion is redundant here and required
    // there, and a script that only typechecks in its author's repository is a
    // script a consumer cannot adopt. The loop bound already proves the element is
    // present, and `''` is not a flag, so the fallthrough reports it rather than
    // hiding it.
    const arg = argv[index] ?? '';
    if (!arg.startsWith('-')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const raw = arg.replace(/^--?/, '');
    const name = aliases[raw] ?? raw;

    if (booleanFlags.has(name)) {
      if (flags.has(name)) {
        throw new Error(`--${name} was given more than once`);
      }
      flags.set(name, true);
      continue;
    }

    if (!valueFlags.has(name)) {
      throw new Error(`Unknown argument: ${arg}`);
    }
    if (flags.has(name)) {
      throw new Error(`--${name} was given more than once`);
    }

    // `argv[index + 1]` is statically a string, but a value flag in last
    // position has no next element at runtime — the length check is what makes
    // the `undefined` below reachable rather than dead.
    const value = index + 1 < argv.length ? argv[index + 1] : undefined;
    // A value that starts with `-` is treated as a missing value so that
    // `--to --dry-run` reports the real problem instead of capturing the flag.
    if (value === undefined || value.startsWith('-')) {
      throw new Error(`--${name} requires a value`);
    }
    flags.set(name, value);
    index += 1;
  }

  return flags;
}

/**
Reads a value flag, or `undefined` when it was not supplied.
*/
export function valueOf(flags: ParsedFlags, name: string): string | undefined {
  const value = flags.get(name);
  return typeof value === 'string' ? value : undefined;
}

/**
Reads a boolean flag, defaulting to `false`.
*/
export function isSet(flags: ParsedFlags, name: string): boolean {
  return flags.get(name) === true;
}

/**
Split `argv` into its positional arguments and the rest, so a caller can accept
`tsx script.ts <dir>` alongside `--root <dir>`.

A token that follows a value flag *is* that flag's value, not a positional: the
naive `argv.filter((arg) => !arg.startsWith('-'))` takes `.` out of
`--root . --fail-on-hard` and then `parseFlags` reports `--root requires a value`.
The value flags are passed in rather than inferred, because only the caller knows
which of its declared flags take one.

@throws when more than `expected` positionals are given, naming them: a second
  directory is far more likely to be a mistyped flag than an intended argument.
*/
export function splitPositional(
  argv: readonly string[],
  valueFlags: readonly string[],
  expected = 1,
): { positional: string[]; rest: string[] } {
  const takes = new Set(valueFlags);
  const positional: string[] = [];
  const rest: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg.startsWith('-')) {
      rest.push(arg);
      continue;
    }
    const previous = argv[index - 1] as string | undefined;
    const isFlagValue = previous !== undefined && previous.startsWith('-') && takes.has(previous.replace(/^--?/, ''));
    if (isFlagValue) {
      rest.push(arg);
      continue;
    }
    positional.push(arg);
  }

  if (positional.length > expected) {
    throw new Error(`Expected at most ${expected} positional argument(s), got: ${positional.join(', ')}`);
  }
  return { positional, rest };
}
