/**
 * auth.js — client-side password hashing helpers.
 *
 * There is no backend here (everything lives in IndexedDB in the browser), so this
 * cannot protect against someone running JavaScript on the page — it only protects
 * stored passwords from casual inspection (e.g. someone opening the IndexedDB tab
 * in DevTools, or a raw export of the database).
 */

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(password, salt) {
  return sha256Hex(`${salt}:${password}`);
}

/** Returns a copy of `user` with a fresh passwordHash/salt for `plainPassword`, and no plaintext password field. */
export async function withHashedPassword(user, plainPassword) {
  const salt = generateSalt();
  const passwordHash = await hashPassword(plainPassword, salt);
  const { password: _password, ...rest } = user;
  return { ...rest, salt, passwordHash };
}

/** Verifies a password against a user record, transparently supporting legacy plaintext accounts. */
export async function verifyPassword(plainPassword, user) {
  if (!user) return false;
  if (user.passwordHash && user.salt) {
    return (await hashPassword(plainPassword, user.salt)) === user.passwordHash;
  }
  // Legacy account created before password hashing was added.
  return user.password === plainPassword;
}

export function passwordStrength(password) {
  if (!password) return { label: '', score: 0 };
  let score = 0;
  if (password.length >= 4) score++;
  if (password.length >= 8) score++;
  if (/[0-9]/.test(password) && /[a-zA-Z]/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password) || password.length >= 12) score++;
  const labels = ['Za krótkie', 'Słabe', 'Średnie', 'Dobre', 'Silne'];
  return { label: labels[score], score };
}
