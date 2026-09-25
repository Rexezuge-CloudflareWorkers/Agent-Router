type Factory<T> = (container: Container) => T;

// Branded token so `scope.get(Tokens.X)` infers `X` without an explicit
// generic at call sites. The brand is optional (and `unknown`-compatible) so
// `Token<Service>` remains assignable to `Token<unknown>` for Map storage.
type Token<T = unknown> = (string | symbol) & { readonly __type?: T };

/**
 * Minimal dependency-injection container (Factory + Singleton scopes).
 *
 * Composition roots (`createRequestScope`, `RepoWorkerFactory`, tests) wire
 * concrete implementations once; handlers resolve via `scope.get(Tokens.X)`.
 * Prefer constructor injection of `I*` ports at registration time over
 * inline `scope.get()` in business logic.
 */
class Container {
  private readonly factories = new Map<Token<unknown>, Factory<unknown>>();
  private readonly singletons = new Map<Token<unknown>, unknown>();
  private disposed = false;

  public bind<T>(token: Token<T>, factory: Factory<T>): this {
    this.assertUsable();
    this.factories.set(token, factory);
    return this;
  }

  public bindValue<T>(token: Token<T>, value: T): this {
    this.assertUsable();
    this.singletons.set(token, value);
    return this;
  }

  public has<T>(token: Token<T>): boolean {
    return this.singletons.has(token) || this.factories.has(token);
  }

  public get<T>(token: Token<T>): T {
    this.assertUsable();
    if (this.singletons.has(token)) {
      return this.singletons.get(token) as T;
    }
    const factory = this.factories.get(token);
    if (!factory) {
      throw new Error(`DI container has no binding for token: ${String(token)}`);
    }
    const instance = (factory as Factory<T>)(this);
    this.singletons.set(token, instance);
    return instance;
  }

  /**
  Resolve without memoizing — for request-scoped objects.
  */
  public resolve<T>(token: Token<T>): T {
    this.assertUsable();
    const factory = this.factories.get(token);
    return factory ? (factory as Factory<T>)(this) : this.get(token);
  }

  public createChild(): Container {
    this.assertUsable();
    const child = new Container();
    for (const [token, value] of this.singletons) {
      child.bindValue(token, value);
    }
    for (const [token, factory] of this.factories) {
      child.bind(token, factory);
    }
    return child;
  }

  // Release memoized singletons (Workers isolation / test teardown).
  public dispose(): void {
    this.factories.clear();
    this.singletons.clear();
    this.disposed = true;
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error('DI container has been disposed.');
  }
}

export { Container };
export type { Factory, Token };
