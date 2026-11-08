/**
 * Display cache of the Clerk session for the toolbar popup.
 *
 * The account page is the session authority (ClerkProvider). It writes this
 * snapshot into `chrome.storage.local` whenever Clerk finishes loading.
 * The popup reads it so the toolbar does not have to boot Clerk on every open.
 * Tokens are never stored here.
 */

export const ACCOUNT_SNAPSHOT_KEY = "browserHand.account";

export interface AccountSnapshot {
  signedIn: boolean;
  userId: string | null;
  email: string | null;
  name: string | null;
  imageUrl: string | null;
  updatedAt: string;
}

/** Subset of Clerk's user resource the account page knows how to mirror. */
export interface ClerkUserLike {
  id: string;
  fullName: string | null;
  imageUrl: string;
  primaryEmailAddress: { emailAddress: string } | null;
}

export function signedOutSnapshot(now: Date = new Date()): AccountSnapshot {
  return {
    signedIn: false,
    userId: null,
    email: null,
    name: null,
    imageUrl: null,
    updatedAt: now.toISOString(),
  };
}

export function snapshotFromUser(user: ClerkUserLike, now: Date = new Date()): AccountSnapshot {
  const email = user.primaryEmailAddress?.emailAddress?.trim() || null;
  const name = user.fullName?.trim() || null;
  return {
    signedIn: true,
    userId: user.id,
    email,
    name,
    imageUrl: user.imageUrl?.trim() || null,
    updatedAt: now.toISOString(),
  };
}

export function isAccountSnapshot(value: unknown): value is AccountSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<AccountSnapshot>;
  return (
    typeof snapshot.signedIn === "boolean" &&
    (snapshot.userId === null || typeof snapshot.userId === "string") &&
    (snapshot.email === null || typeof snapshot.email === "string") &&
    (snapshot.name === null || typeof snapshot.name === "string") &&
    (snapshot.imageUrl === null || typeof snapshot.imageUrl === "string") &&
    typeof snapshot.updatedAt === "string"
  );
}

export function accountPageUrl(): string {
  return chrome.runtime.getURL("account.html");
}
