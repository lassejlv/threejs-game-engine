/**
 * Which projects may run their scripts in the editor. Scripts run in the
 * editor's own page, so an imported project could otherwise read or change the
 * user's other projects. Projects made here are trusted; imported ones (and
 * folders copied into projects/ by hand) ask first. Kept per browser, in
 * localStorage: losing it only means being asked again.
 */

const TRUSTED = 'ge-trusted-projects'
const INITIALIZED = 'ge-trust-initialized'

type Kind = 'disk' | 'browser'
const key = (kind: Kind, id: string) => `${kind}:${id}`

function read(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(TRUSTED) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

function write(set: Set<string>): void {
  try {
    localStorage.setItem(TRUSTED, JSON.stringify([...set]))
  } catch {
    // Storage unavailable: projects ask again next time.
  }
}

export function isTrusted(kind: Kind, id: string): boolean {
  return read().has(key(kind, id))
}

export function setTrusted(kind: Kind, id: string, trusted: boolean): void {
  const set = read()
  if (trusted) set.add(key(kind, id))
  else set.delete(key(kind, id))
  write(set)
}

/**
 * The first time trust tracking runs, projects that already exist were made by
 * this user before the feature existed: trust them rather than ask about each.
 */
export function initTrust(kind: Kind, existing: string[]): void {
  const flag = `${INITIALIZED}:${kind}`
  try {
    if (localStorage.getItem(flag)) return
    localStorage.setItem(flag, '1')
  } catch {
    return
  }
  const set = read()
  for (const id of existing) set.add(key(kind, id))
  write(set)
}
