import {
  ClerkFailed,
  ClerkLoaded,
  ClerkLoading,
  ClerkProvider,
  Show,
  SignIn,
  SignUp,
  UserButton,
  UserProfile,
  useClerk,
  useUser,
} from "@clerk/chrome-extension";
import { useEffect, useState, type ReactNode } from "react";
import { browserHandAppearance } from "../../account/brand";
import { isConfiguredPublishableKey, readClerkConfig } from "../../account/config";
import {
  ACCOUNT_SNAPSHOT_KEY,
  accountPageUrl,
  signedOutSnapshot,
  snapshotFromUser,
} from "../../account/session";
import { OrderHistory } from "./OrderHistory";

function logoUrl(): string {
  return chrome.runtime.getURL("icons/icon-128.png");
}

export default function App() {
  const config = readClerkConfig();
  const pageUrl = accountPageUrl();

  if (!isConfiguredPublishableKey(config.publishableKey)) {
    return (
      <Shell>
        <SetupRequired />
      </Shell>
    );
  }

  return (
    <ClerkProvider
      publishableKey={config.publishableKey}
      {...(config.syncHost ? { syncHost: config.syncHost } : {})}
      afterSignOutUrl={pageUrl}
      signInFallbackRedirectUrl={pageUrl}
      signUpFallbackRedirectUrl={pageUrl}
      signInUrl={`${pageUrl}?auth=sign-in`}
      signUpUrl={`${pageUrl}?auth=sign-up`}
      allowedRedirectProtocols={["chrome-extension:", "https:", "http:"]}
      appearance={browserHandAppearance(logoUrl())}
    >
      <Shell>
        <SessionMirror />
        <ClerkLoading>
          <p className="muted">Loading account…</p>
        </ClerkLoading>
        <ClerkFailed>
          <p className="error">
            Clerk could not start. Check the publishable key, rebuild the extension, and confirm
            this extension&apos;s <code>chrome-extension://</code> origin is in the instance allowed
            origins (<code>npm run clerk:brand</code>).
          </p>
        </ClerkFailed>
        <ClerkLoaded>
          <Show when="signed-out">
            <SignedOutPanel pageUrl={pageUrl} />
          </Show>
          <Show when="signed-in">
            <SignedInPanel />
          </Show>
        </ClerkLoaded>
        <p className="footnote">
          The toolbar toggle still drives your local relay whether or not this account is signed in.
        </p>
      </Shell>
    </ClerkProvider>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="shell">
      <header className="topbar">
        <img className="mark" src={logoUrl()} alt="" width={44} height={44} />
        <div className="wordmark">
          <h1>Browser Hand</h1>
          <p>Account</p>
        </div>
      </header>
      {children}
    </main>
  );
}

function SetupRequired() {
  return (
    <section className="panel setup">
      <h2>Sign-in is not configured</h2>
      <p>
        Browser Hand uses Clerk for sign-in, sign-up, and this account page. Add a publishable key
        and rebuild the extension. The local automation relay keeps working without it.
      </p>
      <ol>
        <li>
          Create a Clerk application named <strong>Browser Hand</strong> and enable the Native API.
        </li>
        <li>
          Copy <code>.env.example</code> to <code>.env</code> at the repo root. Set{" "}
          <code>WXT_CLERK_PUBLISHABLE_KEY</code> and <code>CLERK_SECRET_KEY</code>.
        </li>
        <li>
          Rebuild (<code>npm run build:extension</code>) and reload the unpacked extension. Keys are
          inlined at build time.
        </li>
        <li>
          Copy the extension id from <code>chrome://extensions</code> into{" "}
          <code>CLERK_EXTENSION_ID</code> and run <code>npm run clerk:brand</code> so Clerk allows
          this <code>chrome-extension://</code> origin.
        </li>
      </ol>
    </section>
  );
}

function SessionMirror() {
  const { isLoaded, isSignedIn, user } = useUser();
  useEffect(() => {
    if (!isLoaded) return;
    const snapshot =
      isSignedIn && user
        ? snapshotFromUser({
            id: user.id,
            fullName: user.fullName,
            imageUrl: user.imageUrl,
            primaryEmailAddress: user.primaryEmailAddress
              ? { emailAddress: user.primaryEmailAddress.emailAddress }
              : null,
          })
        : signedOutSnapshot();
    void chrome.storage.local.set({ [ACCOUNT_SNAPSHOT_KEY]: snapshot });
  }, [
    isLoaded,
    isSignedIn,
    user?.id,
    user?.fullName,
    user?.imageUrl,
    user?.primaryEmailAddress?.emailAddress,
    user?.updatedAt,
  ]);
  return null;
}

function readAuthView(): "sign-in" | "sign-up" {
  return new URLSearchParams(window.location.search).get("auth") === "sign-up"
    ? "sign-up"
    : "sign-in";
}

function useAuthView(): "sign-in" | "sign-up" {
  const [view, setView] = useState<"sign-in" | "sign-up">(readAuthView);
  useEffect(() => {
    const onChange = () => setView(readAuthView());
    window.addEventListener("hashchange", onChange);
    window.addEventListener("popstate", onChange);
    return () => {
      window.removeEventListener("hashchange", onChange);
      window.removeEventListener("popstate", onChange);
    };
  }, []);
  return view;
}

function showAuthView(next: "sign-in" | "sign-up"): void {
  const url = new URL(window.location.href);
  url.searchParams.set("auth", next);
  url.hash = "";
  window.history.pushState(null, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function SignedOutPanel({ pageUrl }: { pageUrl: string }) {
  const view = useAuthView();
  const signInUrl = `${pageUrl}?auth=sign-in`;
  const signUpUrl = `${pageUrl}?auth=sign-up`;

  return (
    <div className="auth-layout">
      <div className="auth-tabs" role="tablist" aria-label="Account">
        <button
          type="button"
          role="tab"
          aria-selected={view === "sign-in"}
          onClick={() => showAuthView("sign-in")}
        >
          Sign in
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "sign-up"}
          onClick={() => showAuthView("sign-up")}
        >
          Sign up
        </button>
      </div>
      {view === "sign-in" ? (
        <SignIn
          routing="hash"
          signUpUrl={signUpUrl}
          fallbackRedirectUrl={pageUrl}
          signUpFallbackRedirectUrl={pageUrl}
        />
      ) : (
        <SignUp
          routing="hash"
          signInUrl={signInUrl}
          fallbackRedirectUrl={pageUrl}
          signInFallbackRedirectUrl={pageUrl}
        />
      )}
    </div>
  );
}

function SignedInPanel() {
  const { user } = useUser();
  const clerk = useClerk();
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("sign-in") || hash.includes("sign-up")) {
      const url = new URL(window.location.href);
      url.hash = "";
      window.history.replaceState(null, "", url);
    }
  }, []);
  if (!user) return null;

  const created = user.createdAt
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(user.createdAt)
    : null;

  async function signOut(): Promise<void> {
    await chrome.storage.local.set({ [ACCOUNT_SNAPSHOT_KEY]: signedOutSnapshot() });
    await clerk.signOut({ redirectUrl: accountPageUrl() });
  }

  return (
    <>
      <div
        className="topbar-actions"
        style={{ margin: "0 0 16px auto", justifyContent: "flex-end" }}
      >
        <UserButton />
      </div>
      <section className="panel" aria-labelledby="account-heading">
        <h2 id="account-heading">Account</h2>
        <dl className="account-grid">
          <dt>Name</dt>
          <dd>{user.fullName || "—"}</dd>
          <dt>Email</dt>
          <dd>{user.primaryEmailAddress?.emailAddress || "—"}</dd>
          <dt>User id</dt>
          <dd className="mono">{user.id}</dd>
          {created ? (
            <>
              <dt>Member since</dt>
              <dd>{created}</dd>
            </>
          ) : null}
        </dl>
        <div className="row-actions">
          <button className="button" type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </section>
      <OrderHistory userId={user.id} />
      <section className="panel" aria-labelledby="manage-heading">
        <h2 id="manage-heading">Profile and security</h2>
        <UserProfile routing="hash" />
      </section>
    </>
  );
}
