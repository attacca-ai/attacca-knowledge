export interface IntegrationProvider {
  slug: string

  /**
   * Returns true when the provider has at least one active connection.
   * Semantics: "any connection exists" — does NOT check a specific connectionId.
   * Use `getConnections()` to inspect individual connections.
   */
  hasConnections(): Promise<boolean>

  /**
   * Returns every tracked connection for this provider. May be empty.
   */
  getConnections(): Promise<DirectConnection[]>

  /**
   * Executes an action against a specific connection.
   *
   * `connectionId` resolution rules:
   * - If provided, the action runs against that exact connection.
   * - If omitted and the provider has exactly one connection, that connection
   *   is used as a convenience default.
   * - If omitted and the provider has multiple connections, implementors MUST
   *   throw an explicit error asking the caller to pick a connection. Never
   *   silently pick one — the agent should escalate to the user.
   */
  executeAction(
    actionName: string,
    params: Record<string, unknown>,
    connectionId?: string
  ): Promise<unknown>

  /**
   * Disconnects a single connection by id, or — when `connectionId` is omitted —
   * every connection for this provider. Implementors that support multiple
   * connections MUST honor the id-scoped form.
   */
  disconnect(connectionId?: string): Promise<void>
}

export interface DirectConnection {
  connectionId: string
  toolkit: string
  status: 'active' | 'expired' | 'error'
  meta?: Record<string, string>
}

export interface TokenSet {
  access_token: string
  refresh_token?: string
  expires_at?: number
  scope?: string
}
