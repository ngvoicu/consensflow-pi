const MAX_ARTIFACT_BYTES = 192 * 1024;

export async function collectGitDiff(cwd, execFn) {
  if (!execFn) return null;
  const status = await execFn("git", ["status", "--short"], { cwd });
  const diff = await execFn("git", ["diff", "--stat"], { cwd });
  const patch = await execFn("git", ["diff", "--", "."], { cwd });
  return {
    status: status.code === 0 ? status.stdout : status.stderr,
    stat: diff.code === 0 ? diff.stdout : diff.stderr,
    patch: patch.code === 0 ? patch.stdout.slice(0, MAX_ARTIFACT_BYTES) : patch.stderr,
  };
}
