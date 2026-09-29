const STRICT_UTC_TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{3}))?Z$/;

export function isStrictUtcTimestamp(
  value: string,
): boolean {
  const match =
    STRICT_UTC_TIMESTAMP.exec(
      value,
    );

  if (!match) {
    return false;
  }

  const epochMilliseconds =
    Date.parse(
      value,
    );

  if (
    !Number.isFinite(
      epochMilliseconds,
    )
  ) {
    return false;
  }

  /*
   * Date.parse can normalize invalid calendar dates or accept
   * non-canonical variants. Round-tripping through ISO closes
   * that ambiguity while still permitting second precision.
   */
  const canonical =
    new Date(
      epochMilliseconds,
    ).toISOString();

  const expected =
    match[2] === undefined
      ? `${match[1]}.000Z`
      : value;

  return canonical === expected;
}
