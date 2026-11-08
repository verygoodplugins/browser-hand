interface ImportMetaEnv {
  readonly WXT_CLERK_PUBLISHABLE_KEY?: string;
  readonly WXT_CLERK_SYNC_HOST?: string;
  readonly WXT_CLERK_FRONTEND_API?: string;
  readonly WXT_ORDER_HISTORY_URL?: string;
  readonly WXT_EXTENSION_PUBLIC_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
