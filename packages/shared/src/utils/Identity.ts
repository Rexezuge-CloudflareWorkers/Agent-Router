/**
Canonical email value object.
Consolidates 100+ scattered `email.toLowerCase()` call sites into a single
normalization point. Layer 0 stays dependency-free: validation failures
throw plain `Error`; callers in layers 2-3 map to `BadRequestError`.
*/
class EmailAddress {
  private constructor(private readonly canonical: string) {}

  public static normalize(email: string): string {
    return email.trim().toLowerCase();
  }

  public static parse(email: string): EmailAddress {
    const canonical = this.normalize(email);
    if (!canonical || !canonical.includes('@')) {
      throw new Error('Invalid email address');
    }
    return new this(canonical);
  }

  public static tryParse(email: string | null | undefined): EmailAddress | null {
    if (!email) return null;
    try {
      return this.parse(email);
    } catch {
      return null;
    }
  }

  public toString(): string {
    return this.canonical;
  }

  public valueOf(): string {
    return this.canonical;
  }

  public equals(other: EmailAddress | string): boolean {
    const rhs = typeof other === 'string' ? (this.constructor as typeof EmailAddress).normalize(other) : other.canonical;
    return this.canonical === rhs;
  }

  public prefix(): string {
    return this.canonical.split('@', 1)[0] ?? '';
  }
}

/**
Canonical `owner/name` repository identifier.
Consolidates `normalizeOwner/normalizeRepo(strip .git)` + `OWNER_RE/REPO_RE`
validation spread across `RepoService` and route handlers.
*/
const OWNER_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i;
const REPO_PATTERN = /^[\w.-]{1,100}$/i;

class RepoFullName {
  private constructor(
    public readonly owner: string,
    public readonly name: string,
  ) {}

  public static normalizeOwner(owner: string): string {
    return owner.trim();
  }

  public static normalizeRepo(name: string): string {
    const trimmed = name.trim();
    return trimmed.endsWith('.git') ? trimmed.slice(0, -4) : trimmed;
  }

  public static parse(owner: string, name: string): RepoFullName {
    const normalizedOwner = this.normalizeOwner(owner);
    const normalizedName = this.normalizeRepo(name);
    if (
      normalizedName === '.'
      || normalizedName === '..'
      || normalizedName.startsWith('.')
      || normalizedName.startsWith('-')
      || normalizedName.endsWith('.lock')
      || normalizedName.includes('..')
      || normalizedName.includes('//')
      || !OWNER_PATTERN.test(normalizedOwner)
      || !REPO_PATTERN.test(normalizedName)
    ) {
      throw new Error('Invalid owner or repository name');
    }
    return new this(normalizedOwner, normalizedName);
  }

  public static tryParse(owner: string, name: string): RepoFullName | null {
    try {
      return this.parse(owner, name);
    } catch {
      return null;
    }
  }

  public toString(): string {
    return `${this.owner}/${this.name}`;
  }

  public ownerCi(): string {
    return this.owner.toLowerCase();
  }
}

export { EmailAddress, RepoFullName, OWNER_PATTERN, REPO_PATTERN };
