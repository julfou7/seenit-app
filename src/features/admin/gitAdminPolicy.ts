export function parseSeenItAdminUids(rawValue: string | null | undefined): Set<string> {
  if (!rawValue) return new Set();
  return new Set(
    rawValue
      .split(/[\s,;]+/)
      .map(uid => uid.trim())
      .filter(Boolean)
  );
}

export function isSeenItGitAdmin(
  uid: string | null | undefined,
  rawAllowlist: string | null | undefined
): boolean {
  if (!uid) return false;
  return parseSeenItAdminUids(rawAllowlist).has(uid);
}
