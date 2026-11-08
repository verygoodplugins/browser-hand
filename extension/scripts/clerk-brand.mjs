/**
 * Brand the Clerk instance for Browser Hand and allow this extension origin.
 *
 *   npm run clerk:brand
 *   npm run clerk:brand -- --dry-run
 *
 * Reads CLERK_SECRET_KEY, CLERK_EXTENSION_ID, and optional platform credentials
 * from the environment or the repo-root .env. Never prints secret values.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClerkClient } from "@clerk/backend";
import { loadBrowserHandEnv } from "./load-env.mjs";
import {
  BROWSER_HAND_APPLICATION_NAME,
  applicationFaviconRequest,
  applicationLogoRequest,
  applicationNameRequest,
  chromeExtensionOrigin,
  parseOriginList,
  sendPlatformRequest,
  syncAllowedOrigins,
  ClerkPlatformError,
} from "../account/clerk-setup.ts";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const defaultLogo = path.join(repoRoot, "docs/brand/derived/mark-transparent-512.png");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function isPlaceholder(value) {
  return !value || value.includes("replace_me") || value.includes("your-subdomain");
}

async function main() {
  loadBrowserHandEnv(repoRoot);
  const dryRun = process.argv.includes("--dry-run") || process.env.CLERK_BRAND_DRY_RUN === "1";
  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  const extensionId = process.env.CLERK_EXTENSION_ID?.trim();
  const applicationId = process.env.CLERK_APPLICATION_ID?.trim();
  const platformKey = process.env.CLERK_PLATFORM_SECRET_KEY?.trim() || secretKey;
  const logoPath = process.env.CLERK_LOGO_PATH?.trim()
    ? path.resolve(repoRoot, process.env.CLERK_LOGO_PATH.trim())
    : defaultLogo;

  if (isPlaceholder(secretKey)) {
    fail("Set CLERK_SECRET_KEY in .env (Clerk Dashboard → API keys). Do not commit it.");
  }
  if (isPlaceholder(extensionId)) {
    fail(
      "Set CLERK_EXTENSION_ID to the extension id shown on chrome://extensions (32 letters a-p)."
    );
  }

  let extensionOrigin;
  try {
    extensionOrigin = chromeExtensionOrigin(extensionId);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  let extraOrigins = [];
  try {
    extraOrigins = parseOriginList(process.env.CLERK_EXTRA_ALLOWED_ORIGINS);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  const originsToAdd = [extensionOrigin, ...extraOrigins];
  console.log(`Browser Hand Clerk setup${dryRun ? " (dry run)" : ""}`);
  console.log(`Extension origin: ${extensionOrigin}`);
  console.log(`Origins this run will add: ${originsToAdd.join(", ")}`);

  if (dryRun) {
    console.log("Dry run: no Clerk API calls were made.");
    if (!applicationId) {
      console.log(
        "Application name and logo were not changed. Set CLERK_APPLICATION_ID (and CLERK_PLATFORM_SECRET_KEY when the Platform API uses a separate token) to rename the app to Browser Hand and upload the glove mark."
      );
    }
    return;
  }

  const clerk = createClerkClient({ secretKey });
  const allowedOrigins = await syncAllowedOrigins(clerk.instance, originsToAdd);
  console.log(`Updated instance allowed origins: ${allowedOrigins.join(", ")}`);

  if (!applicationId || isPlaceholder(applicationId)) {
    console.log(
      `Instance origins are updated. To set the Clerk application name to "${BROWSER_HAND_APPLICATION_NAME}" and upload the glove logo (emails and Account Portal), set CLERK_APPLICATION_ID and, if required, CLERK_PLATFORM_SECRET_KEY, then run this again. You can also set both in the Clerk Dashboard under Settings → Branding. In-extension components are already themed with the Browser Hand appearance.`
    );
    return;
  }

  if (!platformKey || isPlaceholder(platformKey)) {
    fail("Set CLERK_PLATFORM_SECRET_KEY or CLERK_SECRET_KEY before updating application branding.");
  }

  const logoBytes = new Uint8Array(await readFile(logoPath));
  const filename = path.basename(logoPath);

  try {
    await sendPlatformRequest(applicationNameRequest(applicationId, platformKey));
    console.log(`Renamed the Clerk application to ${BROWSER_HAND_APPLICATION_NAME}.`);
    await sendPlatformRequest(
      applicationLogoRequest(applicationId, platformKey, logoBytes, filename)
    );
    console.log(`Uploaded ${filename} as the Clerk application logo.`);
  } catch (error) {
    if (error instanceof ClerkPlatformError && (error.status === 401 || error.status === 403)) {
      fail(
        `${error.message}\nThe Platform API uses a platform access token. Set CLERK_PLATFORM_SECRET_KEY if it differs from CLERK_SECRET_KEY, or set the name and logo in the Clerk Dashboard (Settings → Branding). Component theming in the extension does not depend on this step.`
      );
    }
    fail(error instanceof Error ? error.message : String(error));
  }

  try {
    await sendPlatformRequest(
      applicationFaviconRequest(applicationId, platformKey, logoBytes, filename)
    );
    console.log("Uploaded the Clerk application favicon.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`Favicon was not updated (${message}). The logo upload still stands.`);
  }
}

const isDirectRun =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  main().catch((error) => {
    fail(error instanceof Error ? error.message : String(error));
  });
}
