import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface SecurityServiceOptions {
  masterKey?: string;
  salt?: string | Buffer;
  keyDir?: string;
}

export interface MasterKeyAndSalt {
  key: string;
  salt: Buffer;
}

export const LEGACY_DEFAULT_SALT = Buffer.from('cline-web-salt-v1', 'utf8');

export class SecurityService {
  private static instance: SecurityService;
  private derivedKey: Buffer;

  constructor(options: SecurityServiceOptions = {}) {
    let masterSecret: string;
    let salt: Buffer;

    if (options.masterKey) {
      masterSecret = options.masterKey;
      if (options.salt) {
        salt = Buffer.isBuffer(options.salt)
          ? options.salt
          : Buffer.from(options.salt, 'hex');
      } else {
        salt = LEGACY_DEFAULT_SALT;
      }
    } else {
      const resolved = this.resolveMasterKeyAndSalt(options.keyDir);
      masterSecret = resolved.key;
      salt = resolved.salt;
    }

    // Derive a 32-byte (256-bit) AES key using scrypt with 16-byte random salt
    this.derivedKey = crypto.scryptSync(masterSecret, salt, 32);
  }

  public static getInstance(options?: SecurityServiceOptions): SecurityService {
    if (!SecurityService.instance) {
      SecurityService.instance = new SecurityService(options);
    }
    return SecurityService.instance;
  }

  public static resetInstance(): void {
    SecurityService.instance = undefined as any;
  }

  /**
   * Resolves or generates the persistent master key and random salt.
   * Priority:
   * 1. process.env.APP_MASTER_KEY or process.env.CLINE_SECRET_KEY (JSON or string)
   * 2. Key stored in ~/.harni/.master.key (or legacy ~/.cline-web/.master.key)
   * 3. Auto-generate new 256-bit random key and 16-byte random salt, saved to disk as JSON
   * 4. Fallback: In-memory ephemeral CSPRNG random key & salt (never predictable machine metadata)
   */
  public resolveMasterKeyAndSalt(customDir?: string): MasterKeyAndSalt {
    const envKey = process.env.APP_MASTER_KEY || process.env.CLINE_SECRET_KEY;
    if (envKey && envKey.trim()) {
      const trimmed = envKey.trim();
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed.key) {
            const parsedSalt = parsed.salt
              ? Buffer.from(parsed.salt, 'hex')
              : LEGACY_DEFAULT_SALT;
            return { key: parsed.key, salt: parsedSalt };
          }
        } catch {}
      }
      return { key: trimmed, salt: LEGACY_DEFAULT_SALT };
    }

    const dir = customDir || path.join(os.homedir(), '.harni');
    const keyPath = path.join(dir, '.master.key');
    const legacyKeyPath = path.join(os.homedir(), '.cline-web', '.master.key');

    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Check primary key path
      if (fs.existsSync(keyPath)) {
        const stored = fs.readFileSync(keyPath, 'utf8').trim();
        if (stored.startsWith('{') && stored.endsWith('}')) {
          try {
            const parsed = JSON.parse(stored);
            if (parsed.key && typeof parsed.key === 'string' && parsed.key.length >= 16) {
              const saltBuf = parsed.salt
                ? Buffer.from(parsed.salt, 'hex')
                : LEGACY_DEFAULT_SALT;
              return { key: parsed.key, salt: saltBuf };
            }
          } catch {}
        }

        // Legacy format: raw hex or text key
        if (stored.length >= 16) {
          return { key: stored, salt: LEGACY_DEFAULT_SALT };
        }
      }

      // Auto-migration: If no key in .harni yet, check if legacy .cline-web key exists
      if (!customDir && fs.existsSync(legacyKeyPath)) {
        try {
          const legacyStored = fs.readFileSync(legacyKeyPath, 'utf8').trim();
          fs.writeFileSync(keyPath, legacyStored, { encoding: 'utf8', mode: 0o600 });
          console.log(`[SecurityService] Migrated master key from ${legacyKeyPath} to ${keyPath}`);
          if (legacyStored.startsWith('{') && legacyStored.endsWith('}')) {
            const parsed = JSON.parse(legacyStored);
            if (parsed.key && typeof parsed.key === 'string' && parsed.key.length >= 16) {
              const saltBuf = parsed.salt
                ? Buffer.from(parsed.salt, 'hex')
                : LEGACY_DEFAULT_SALT;
              return { key: parsed.key, salt: saltBuf };
            }
          } else if (legacyStored.length >= 16) {
            return { key: legacyStored, salt: LEGACY_DEFAULT_SALT };
          }
        } catch (err) {
          console.warn(`[SecurityService] Failed to migrate legacy master key:`, err);
        }
      }

      // Generate a new cryptographically secure 256-bit random hex key and 16-byte random salt
      const newKey = crypto.randomBytes(32).toString('hex');
      const newSalt = crypto.randomBytes(16);
      const fileData = JSON.stringify(
        {
          version: 1,
          key: newKey,
          salt: newSalt.toString('hex'),
        },
        null,
        2,
      );
      fs.writeFileSync(keyPath, fileData, { encoding: 'utf8', mode: 0o600 });
      return { key: newKey, salt: newSalt };
    } catch (err) {
      console.warn(
        '[SecurityService] Warning: Could not persist master key file, falling back to ephemeral in-memory random key:',
        err,
      );
      // Ephemeral fallback: CSPRNG in-memory key and salt (safe against local multi-user enumeration)
      const ephemeralKey = crypto.randomBytes(32).toString('hex');
      const ephemeralSalt = crypto.randomBytes(16);
      return { key: ephemeralKey, salt: ephemeralSalt };
    }
  }

  /**
   * Encrypts plaintext string using AES-256-GCM.
   * Output format: `enc:v1:<ivHex>:<authTagHex>:<cipherHex>`
   */
  public encrypt(plainText: string): string {
    if (!plainText) return '';

    const iv = crypto.randomBytes(12); // 12-byte IV standard for AES-GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', this.derivedKey, iv);

    let encrypted = cipher.update(plainText, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return `enc:v1:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  /**
   * Decrypts ciphertext string.
   * If input is not in `enc:v1:...` format, returns input gracefully (for legacy migration).
   */
  public decrypt(cipherText: string): string {
    if (!cipherText) return '';

    if (!cipherText.startsWith('enc:v1:')) {
      // Legacy plaintext
      return cipherText;
    }

    const parts = cipherText.split(':');
    if (parts.length !== 5) {
      throw new Error('Invalid encrypted format');
    }

    const [, , ivHex, tagHex, encryptedHex] = parts;
    if (!ivHex || !tagHex || !encryptedHex) {
      throw new Error('Corrupted ciphertext');
    }

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.derivedKey, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Masks an API Key for safe user-facing display (e.g. `sk-••••••••1234`)
   */
  public maskApiKey(apiKey?: string | null): string {
    if (!apiKey) return '';
    const trimmed = apiKey.trim();
    if (trimmed.length <= 8) {
      return '••••••••';
    }

    const prefix = trimmed.startsWith('sk-') ? 'sk-' : '';
    const suffix = trimmed.slice(-4);
    return `${prefix}••••••••${suffix}`;
  }
}
