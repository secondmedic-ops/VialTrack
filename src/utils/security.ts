/**
 * Security and Password Management Utilities for SecondMedic VialTrack
 */

/**
 * Generates a random 8-10 character alphanumeric string with numbers and symbols
 * Example output: "Vk8#9xQ2"
 */
export function generateStrongPassword(length = 9): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%^&*';

  // Ensure at least one character from each set
  const requiredChars = [
    upper[Math.floor(Math.random() * upper.length)],
    lower[Math.floor(Math.random() * lower.length)],
    digits[Math.floor(Math.random() * digits.length)],
    symbols[Math.floor(Math.random() * symbols.length)]
  ];

  const allChars = upper + lower + digits + symbols;
  const remainingLength = Math.max(8, length) - requiredChars.length;

  for (let i = 0; i < remainingLength; i++) {
    requiredChars.push(allChars[Math.floor(Math.random() * allChars.length)]);
  }

  // Shuffle the result
  return requiredChars.sort(() => Math.random() - 0.5).join('');
}

/**
 * Validates that a password satisfies:
 * - Minimum 8 characters
 * - At least 1 number
 * - At least 1 special character
 * Returns valid status, error message if any, and strength score (1-4).
 */
export function validatePasswordStrength(password: string): { valid: boolean; score: number; error?: string } {
  let score = 0;
  if (!password) {
    return { valid: false, score: 0, error: 'Password is required.' };
  }

  if (password.length >= 8) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[A-Z]/.test(password) || /[a-z]/.test(password)) score++;
  if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) score++;

  if (password.length < 8) {
    return { valid: false, score, error: 'Password must be at least 8 characters long.' };
  }
  if (!/\d/.test(password)) {
    return { valid: false, score, error: 'Password must contain at least one numeric digit (0-9).' };
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    return { valid: false, score, error: 'Password must contain at least one special symbol (e.g. !@#$%^&*).' };
  }
  return { valid: true, score };
}

/**
 * Formats standard portal credentials message for clipboard sharing
 */
export function formatCredentialsMessage(options: {
  portalUrl: string;
  loginId: string;
  tempPassword: string;
}): string {
  return `SecondMedic VialTrack Portal Access:
Portal URL: ${options.portalUrl}
Login ID: ${options.loginId}
Temporary Password: ${options.tempPassword}`;
}

/**
 * Robust clipboard copying helper
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback to execCommand
  }

  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    return successful;
  } catch (err) {
    console.error('Fallback clipboard copy failed:', err);
    return false;
  }
}
