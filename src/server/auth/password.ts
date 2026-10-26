import bcrypt from "bcryptjs";

const COST = Number(process.env.BCRYPT_COST ?? 12);

/** Hash ficticio para igualar tiempos cuando el usuario no existe. */
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", COST);

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(
  plain: string,
  hash: string | null | undefined,
): Promise<boolean> {
  return bcrypt.compare(plain, hash ?? DUMMY_HASH);
}

export const PASSWORD_MIN_LENGTH = 8;

export function passwordPolicyErrors(plain: string): string[] {
  const errors: string[] = [];
  if (plain.length < PASSWORD_MIN_LENGTH) {
    errors.push(`Debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`);
  }
  if (!/[a-zA-Z]/.test(plain)) errors.push("Debe incluir al menos una letra.");
  if (!/[0-9]/.test(plain)) errors.push("Debe incluir al menos un número.");
  return errors;
}

/** Contraseña temporal legible: 3 bloques de 4 caracteres sin ambigüedades. */
export function generateTemporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    if (i > 0 && i % 4 === 0) out += "-";
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}
