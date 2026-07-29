const DEFAULT_PROFILE_NAME = 'default';

const DEFAULT_PROFILE_CONFIG = {
  emailByContext: {
    default: 'default',
    personal: 'personal',
    work: 'work',
    financial: 'financial',
    travel: 'travel',
  },
  addressByContext: {
    default: 'mailing',
    personal: 'mailing',
    work: 'mailing',
    financial: 'billing',
    travel: 'mailing',
    billing: 'billing',
  },
  card: 'default',
};

const SENSITIVE_KINDS = new Set([
  'cardNumber',
  'cardExpiry',
  'cardExpMonth',
  'cardExpYear',
  'cardCvv',
  'cardName',
  'ssn',
  'dob',
  'dobDay',
  'dobMonth',
  'dobYear',
  'password',
  'fullName',
]);

export function buildAutofillProfilePlan({
  controls = [],
  autofill = {},
  profile = DEFAULT_PROFILE_NAME,
  contextHint = '',
  page = {},
} = {}) {
  const profileName = normalizeProfileName(profile);
  const profileConfig = getProfileConfig(autofill, profileName);
  const context = inferAutofillProfileContext({
    controls,
    contextHint,
    page,
    profileConfig,
  });

  const fields = {};
  const matched = [];
  const skipped = [];

  for (const control of Array.isArray(controls) ? controls : []) {
    const label = getControlLabel(control);
    if (!label) {
      continue;
    }

    const classification = classifyControl(control);
    if (!classification) {
      skipped.push({ label, reason: 'no deterministic profile rule' });
      continue;
    }

    const resolved = resolveClassificationValue({
      classification,
      autofill,
      context,
    });

    if (resolved.value === undefined || resolved.value === null) {
      skipped.push({ label, reason: 'profile value unavailable' });
      continue;
    }

    fields[label] = resolved.value;
    matched.push({
      label,
      kind: classification.kind,
      profileKey: resolved.profileKey,
      sensitive:
        classification.sensitive === true ||
        SENSITIVE_KINDS.has(classification.kind),
    });
  }

  return {
    profile: profileName,
    context,
    fields,
    matched,
    skipped,
  };
}

export function inferAutofillProfileContext({
  controls = [],
  contextHint = '',
  page = {},
  profileConfig = DEFAULT_PROFILE_CONFIG,
} = {}) {
  const text = normalizeText([
    contextHint,
    page?.title,
    page?.url,
    ...controls.map(control => getControlSearchText(control)),
  ]);

  const emailContext = inferEmailContext(text);
  const addressContext = inferAddressContext(text, emailContext);

  return {
    email: selectConfiguredContext(
      profileConfig.emailByContext,
      emailContext,
      'default'
    ),
    address: selectConfiguredContext(
      profileConfig.addressByContext,
      addressContext,
      'mailing'
    ),
    card: String(profileConfig.card || 'default'),
  };
}

function normalizeProfileName(profile) {
  const value = String(profile || '').trim();
  return value || DEFAULT_PROFILE_NAME;
}

function getProfileConfig(autofill, profileName) {
  const profiles =
    autofill?.profiles &&
    typeof autofill.profiles === 'object' &&
    !Array.isArray(autofill.profiles)
      ? autofill.profiles
      : {};
  return deepMerge(
    DEFAULT_PROFILE_CONFIG,
    objectOrEmpty(profiles.default),
    objectOrEmpty(profiles[profileName])
  );
}

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

function deepMerge(...sources) {
  const out = {};
  for (const source of sources) {
    for (const [key, value] of Object.entries(source || {})) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        out[key] = deepMerge(objectOrEmpty(out[key]), value);
      } else if (value !== undefined) {
        out[key] = value;
      }
    }
  }
  return out;
}

function selectConfiguredContext(map, context, fallback) {
  if (map && Object.prototype.hasOwnProperty.call(map, context)) {
    return String(map[context] || fallback);
  }
  if (map && Object.prototype.hasOwnProperty.call(map, 'default')) {
    return String(map.default || fallback);
  }
  return fallback;
}

function inferEmailContext(text) {
  if (hasAny(text, TRAVEL_TERMS)) {
    return 'travel';
  }
  if (hasAny(text, WORK_TERMS)) {
    return 'work';
  }
  if (hasAny(text, FINANCIAL_TERMS)) {
    return 'financial';
  }
  if (hasAny(text, PERSONAL_TERMS)) {
    return 'personal';
  }
  return 'default';
}

function inferAddressContext(text, emailContext) {
  if (hasAny(text, BILLING_TERMS) || emailContext === 'financial') {
    return 'billing';
  }
  return 'mailing';
}

const FINANCIAL_TERMS = [
  'bank',
  'banking',
  'billing',
  'card',
  'chase',
  'credit',
  'finance',
  'financial',
  'loan',
  'payment',
];

const TRAVEL_TERMS = [
  'airline',
  'airport',
  'booking',
  'flight',
  'hotel',
  'passenger',
  'reservation',
  'travel',
  'trip',
];

const WORK_TERMS = ['business', 'company', 'employer', 'office', 'work'];
const PERSONAL_TERMS = ['home', 'personal'];
const BILLING_TERMS = ['billing', 'card', 'payment'];

function hasAny(text, terms) {
  return terms.some(term => includesWord(text, term));
}

function includesWord(text, term) {
  return new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i').test(text);
}

function classifyControl(control) {
  const type = normalizeText(control?.type);
  const autocomplete = normalizeText(control?.autocomplete);
  const text = normalizeText(getControlSearchText(control));

  if (isNonFillableControl(type, text)) {
    return null;
  }

  if (autocomplete.includes('cc number') || hasPhrase(text, 'card number')) {
    return { kind: 'cardNumber' };
  }
  if (
    autocomplete.includes('cc exp month') ||
    hasPhrase(text, 'expiration month') ||
    hasPhrase(text, 'exp month')
  ) {
    return { kind: 'cardExpMonth' };
  }
  if (
    autocomplete.includes('cc exp year') ||
    hasPhrase(text, 'expiration year') ||
    hasPhrase(text, 'exp year')
  ) {
    return { kind: 'cardExpYear' };
  }
  if (
    autocomplete.includes('cc exp') ||
    hasPhrase(text, 'expiration date') ||
    includesWord(text, 'expiry') ||
    hasPhrase(text, 'exp date')
  ) {
    return { kind: 'cardExpiry' };
  }
  if (
    autocomplete.includes('cc csc') ||
    includesWord(text, 'cvv') ||
    includesWord(text, 'cvc') ||
    hasPhrase(text, 'security code')
  ) {
    return { kind: 'cardCvv' };
  }
  if (
    autocomplete.includes('cc name') ||
    hasPhrase(text, 'name on card') ||
    includesWord(text, 'cardholder')
  ) {
    return { kind: 'cardName' };
  }

  if (
    includesWord(text, 'ssn') ||
    hasPhrase(text, 'social security') ||
    hasPhrase(text, 'tax id')
  ) {
    return { kind: 'ssn' };
  }

  if (autocomplete.includes('bday day') || hasPhrase(text, 'birth day')) {
    return { kind: 'dobDay' };
  }
  if (autocomplete.includes('bday month') || hasPhrase(text, 'birth month')) {
    return { kind: 'dobMonth' };
  }
  if (autocomplete.includes('bday year') || hasPhrase(text, 'birth year')) {
    return { kind: 'dobYear' };
  }
  if (
    autocomplete.includes('bday') ||
    includesWord(text, 'dob') ||
    hasPhrase(text, 'date of birth') ||
    includesWord(text, 'birthdate')
  ) {
    return { kind: 'dob' };
  }

  if (
    type === 'email' ||
    autocomplete.includes('email') ||
    includesWord(text, 'email')
  ) {
    return { kind: 'email' };
  }

  if (
    type === 'tel' ||
    autocomplete.includes('tel') ||
    includesWord(text, 'phone') ||
    includesWord(text, 'mobile')
  ) {
    return { kind: 'phone' };
  }

  const addressKind = classifyAddressControl(text, autocomplete);
  if (addressKind) {
    return { kind: 'address', addressKey: addressKind };
  }

  if (autocomplete.includes('given name') || hasPhrase(text, 'first name')) {
    return { kind: 'firstName' };
  }
  if (
    autocomplete.includes('family name') ||
    hasPhrase(text, 'last name') ||
    includesWord(text, 'surname')
  ) {
    return { kind: 'lastName' };
  }
  if (
    autocomplete === 'name' ||
    hasPhrase(text, 'full name') ||
    hasPhrase(text, 'legal name') ||
    text === 'name'
  ) {
    return { kind: 'fullName' };
  }

  if (includesWord(text, 'company') || includesWord(text, 'organization')) {
    return { kind: 'company' };
  }

  if (type === 'password' || includesWord(text, 'password')) {
    return { kind: 'password' };
  }

  return null;
}

function isNonFillableControl(type, text) {
  return (
    type === 'hidden' ||
    type === 'submit' ||
    type === 'button' ||
    type === 'reset' ||
    hasPhrase(text, 'search')
  );
}

function classifyAddressControl(text, autocomplete) {
  if (autocomplete.includes('address line1')) {
    return 'line1';
  }
  if (autocomplete.includes('address line2')) {
    return 'line2';
  }
  if (autocomplete.includes('address level2')) {
    return 'city';
  }
  if (autocomplete.includes('address level1')) {
    return 'state';
  }
  if (autocomplete.includes('postal code')) {
    return 'zip';
  }
  if (autocomplete === 'country' || autocomplete.includes('country name')) {
    return 'country';
  }
  if (hasPhrase(text, 'address line 1') || hasPhrase(text, 'street address')) {
    return 'line1';
  }
  if (hasPhrase(text, 'address line 2') || hasPhrase(text, 'apartment')) {
    return 'line2';
  }
  if (includesWord(text, 'city')) {
    return 'city';
  }
  if (
    includesWord(text, 'state') ||
    includesWord(text, 'province') ||
    includesWord(text, 'region')
  ) {
    return 'state';
  }
  if (
    includesWord(text, 'zip') ||
    includesWord(text, 'postal') ||
    hasPhrase(text, 'post code')
  ) {
    return 'zip';
  }
  if (includesWord(text, 'country')) {
    return 'country';
  }
  if (includesWord(text, 'address') && !includesWord(text, 'email')) {
    return 'line1';
  }
  return null;
}

function resolveClassificationValue({ classification, autofill, context }) {
  switch (classification.kind) {
    case 'email':
      return resolveEmailValue(autofill, context.email);
    case 'phone':
      return firstValue([
        profileValue(autofill, 'phone', 'phone'),
        secureFallback('phone'),
      ]);
    case 'firstName':
      return firstValue([
        profileValue(autofill, 'firstName', 'firstName'),
        secureFallback('firstName'),
      ]);
    case 'lastName':
      return firstValue([
        profileValue(autofill, 'lastName', 'lastName'),
        secureFallback('lastName'),
      ]);
    case 'fullName':
      return firstValue([
        profileValue(autofill, 'legalName', 'legalName'),
        profileValue(autofill, 'fullName', 'fullName'),
        combinedNameValue(autofill),
        secureFallback('legalName'),
      ]);
    case 'company':
      return firstValue([profileValue(autofill, 'company', 'company')]);
    case 'address':
      return resolveAddressValue(autofill, context.address, classification);
    case 'cardNumber':
      return resolveCardValue(autofill, context.card, 'number');
    case 'cardExpiry':
      return resolveCardValue(autofill, context.card, 'expiry');
    case 'cardExpMonth':
      return resolveCardValue(autofill, context.card, 'expMonth');
    case 'cardExpYear':
      return resolveCardValue(autofill, context.card, 'expYear');
    case 'cardCvv':
      return resolveCardValue(autofill, context.card, 'cvv');
    case 'cardName':
      return firstValue([
        resolveCardValue(autofill, context.card, 'name'),
        profileValue(autofill, 'legalName', 'legalName'),
        secureFallback('legalName'),
      ]);
    case 'ssn':
      return firstValue([
        profileValue(autofill, 'ssn', 'ssn'),
        secureFallback('ssn'),
      ]);
    case 'dob':
      return firstValue([
        profileValue(autofill, 'dob', 'dob'),
        secureFallback('dob'),
      ]);
    case 'dobDay':
      return firstValue([
        profileValue(autofill, 'dob.day', 'dob.day'),
        secureFallback('dob.day'),
      ]);
    case 'dobMonth':
      return firstValue([
        profileValue(autofill, 'dob.month', 'dob.month'),
        secureFallback('dob.month'),
      ]);
    case 'dobYear':
      return firstValue([
        profileValue(autofill, 'dob.year', 'dob.year'),
        secureFallback('dob.year'),
      ]);
    case 'password':
      return firstValue([
        profileValue(autofill, 'password', 'password'),
        secureFallback('password'),
      ]);
    default:
      return { value: undefined, profileKey: '' };
  }
}

function resolveEmailValue(autofill, emailAlias) {
  const alias = String(emailAlias || 'default');
  if (alias === 'default') {
    return firstValue([
      profileValue(autofill, 'emails.default', 'emails.default'),
      profileValue(autofill, 'email', 'email'),
    ]);
  }
  return firstValue([
    profileValue(autofill, `emails.${alias}`, `emails.${alias}`),
    secureFallback(`emails.${alias}`),
    alias === 'personal' ? profileValue(autofill, 'email', 'email') : null,
  ]);
}

function resolveAddressValue(autofill, addressAlias, classification) {
  const alias = String(addressAlias || 'mailing');
  const key = classification.addressKey;
  const addressPath = alias === 'mailing' ? `address.${key}` : null;
  return firstValue([
    profileValue(
      autofill,
      `addresses.${alias}.${key}`,
      `addresses.${alias}.${key}`
    ),
    addressPath ? profileValue(autofill, addressPath, addressPath) : null,
    secureFallback(`${alias}.address.${key}`),
  ]);
}

function resolveCardValue(autofill, cardAlias, key) {
  const alias = String(cardAlias || 'default');
  return firstValue([
    profileValue(autofill, `cards.${alias}.${key}`, `cards.${alias}.${key}`),
    secureFallback(`cards.${alias}.${key}`),
  ]);
}

function combinedNameValue(autofill) {
  const firstName = lookupDotted(autofill, 'firstName');
  const lastName = lookupDotted(autofill, 'lastName');
  if (!firstName || !lastName) {
    return null;
  }
  return {
    value: '{me:firstName} {me:lastName}',
    profileKey: 'firstName+lastName',
  };
}

function profileValue(autofill, path, profileKey) {
  const value = lookupDotted(autofill, path);
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return { value, profileKey };
}

function secureFallback(key) {
  return {
    value: `{secure:${key}}`,
    profileKey: key,
  };
}

function firstValue(entries) {
  return entries.find(entry => entry && entry.value !== undefined) || {};
}

function getControlLabel(control) {
  return firstString([
    ...(Array.isArray(control?.labels) ? control.labels : []),
    control?.label,
    control?.ariaLabel,
    control?.placeholder,
    control?.name,
    control?.id,
    control?.autocomplete,
  ]);
}

function firstString(values) {
  for (const value of values) {
    const str = String(value || '').trim();
    if (str) {
      return str;
    }
  }
  return '';
}

function getControlSearchText(control) {
  return [
    ...(Array.isArray(control?.labels) ? control.labels : []),
    control?.label,
    control?.ariaLabel,
    control?.placeholder,
    control?.name,
    control?.id,
    control?.autocomplete,
    control?.type,
  ]
    .filter(Boolean)
    .join(' ');
}

function normalizeText(value) {
  if (Array.isArray(value)) {
    return normalizeText(value.join(' '));
  }
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function hasPhrase(text, phrase) {
  return normalizeText(text).includes(normalizeText(phrase));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function lookupDotted(obj, dottedPath) {
  return String(dottedPath || '')
    .split('.')
    .reduce((acc, key) => {
      if (acc && typeof acc === 'object' && key in acc) {
        return acc[key];
      }
      return undefined;
    }, obj);
}
