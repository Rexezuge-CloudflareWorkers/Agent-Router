import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
Whether this module is the process's entrypoint.

The comparison needs **both** sides resolved through `realpathSync`, and that
is not a detail. `process.argv[1]` is whatever the caller typed — under pnpm
that is `node_modules/@rexezuge/tooling/dist/scripts/…`, a **symlink** into the
store — while `import.meta.url` is always the realpath, because the ESM
resolver follows links. So the two never matched, the guard never fired, and
every script below exited 0 having printed nothing.

That is the worst shape a gate can fail in: it looks green. `check-god-files`
reported no file over the limit for every repository that adopted it,
`validate-locales` passed with a key missing from eleven bundles, and neither
said a word. Found by AWS-AccessBridge swapping in its own `validate_locales`
and finding that the replacement stopped catching the defect the old one
reported on the same tree.

It is worth a function rather than an inline comparison because four scripts
carry the same guard, and a shared helper is what makes the fifth correct
instead of a fourth copy of the same mistake.

A missing or unreadable entrypoint is not the entrypoint, and the caller
exports the rule functions precisely so the module stays importable — a suite
imports these to test the rules, and there `process.argv[1]` is the test file.
*/
export function isEntrypoint(moduleUrl: string, argv1: string | undefined = process.argv[1]): boolean {
  if (argv1 === undefined) {
    return false;
  }
  try {
    return moduleUrl === pathToFileURL(realpathSync(argv1)).href;
  } catch {
    // A path that does not resolve cannot be the file that is running.
    return false;
  }
}
