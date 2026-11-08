import type { Appearance } from "@clerk/ui/internal";

/**
 * Browser Hand palette, locked in docs/brand/INDEX.md.
 * Bone ground, ink text, cyan spark as the Clerk primary.
 */
export const BROWSER_HAND_COLORS = {
  ink: "#0B0A12",
  inkRaised: "#15111F",
  bone: "#F7F4EE",
  boneDeep: "#E7E1D6",
  mist: "#5C574F",
  cyan: "#7EE7FF",
  green: "#4CAF50",
} as const;

export const BROWSER_HAND_APPLICATION_NAME = "Browser Hand";

const FONT = '"Avenir Next", "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif';

/**
 * Clerk `appearance` for prebuilt SignIn, SignUp, UserButton, and UserProfile.
 * `logoUrl` should be an extension `chrome-extension://` URL for the glove mark.
 * Component theming is client-side. Email and Account Portal branding (application
 * name and logo) are applied with `npm run clerk:brand`, which calls Clerk's Backend
 * and Platform APIs.
 */
export function browserHandAppearance(logoUrl: string): Appearance {
  return {
    variables: {
      colorPrimary: BROWSER_HAND_COLORS.cyan,
      colorPrimaryForeground: BROWSER_HAND_COLORS.ink,
      colorForeground: BROWSER_HAND_COLORS.ink,
      colorMutedForeground: BROWSER_HAND_COLORS.mist,
      colorBackground: "#FFFFFF",
      colorInput: "#FFFFFF",
      colorInputForeground: BROWSER_HAND_COLORS.ink,
      colorNeutral: BROWSER_HAND_COLORS.inkRaised,
      colorBorder: BROWSER_HAND_COLORS.boneDeep,
      colorDanger: "#EF4444",
      colorSuccess: BROWSER_HAND_COLORS.green,
      colorWarning: "#E6A23C",
      fontFamily: FONT,
      fontFamilyButtons: FONT,
      borderRadius: "0.625rem",
    },
    options: {
      logoImageUrl: logoUrl,
      logoLinkUrl: "https://github.com/verygoodplugins/browser-hand",
      logoPlacement: "inside",
      socialButtonsVariant: "blockButton",
    },
    elements: {
      card: {
        border: `1px solid ${BROWSER_HAND_COLORS.boneDeep}`,
        boxShadow: "none",
      },
      headerTitle: {
        color: BROWSER_HAND_COLORS.ink,
        fontWeight: 600,
      },
      headerSubtitle: {
        color: BROWSER_HAND_COLORS.mist,
      },
      formButtonPrimary: {
        color: BROWSER_HAND_COLORS.ink,
        fontWeight: 600,
      },
    },
  };
}
