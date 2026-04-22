export type RiskLevel = 'low' | 'mid' | 'high' | 'na'
export type CapabilityType = 'read' | 'write' | 'warn'
export type ResultStatus = 'success' | 'partial' | 'not_possible'

export interface ToolCapability {
  name: string
  type: CapabilityType
  risk: RiskLevel
}

export interface CustomToolResult {
  status: ResultStatus
  toolName: string
  toolType: string
  authType: string
  scopes: string[]
  webhooksAvailable: boolean
  webhookPlan?: string | null
  pollingFallback: boolean
  capabilities: ToolCapability[]
  limitations?: string | null
}

interface ToolResultViewProps {
  result: CustomToolResult
  onRetry: () => void
  onConnect: () => void
}

const RISK_STYLES: Record<RiskLevel, string> = {
  low: 'bg-att-green/10 text-att-green',
  mid: 'bg-att-orange/10 text-att-orange',
  high: 'bg-att-red/10 text-att-red',
  na: 'bg-att-surface-raised text-muted-foreground/60'
}

const RISK_LABELS: Record<RiskLevel, string> = {
  low: 'low-risk',
  mid: 'mid-risk',
  high: 'high-risk',
  na: 'según plan'
}

const CAP_ICON_STYLES: Record<CapabilityType, string> = {
  read: 'bg-att-green/10 text-att-green',
  write: 'bg-att-blue/12 text-att-blue',
  warn: 'bg-att-orange/10 text-att-orange'
}

const CAP_ICONS: Record<CapabilityType, string> = {
  read: '👁',
  write: '✏️',
  warn: '⚠️'
}

export function ToolResultView({
  result,
  onRetry,
  onConnect
}: ToolResultViewProps): React.JSX.Element {
  const isNotPossible = result.status === 'not_possible'
  const isPartial = result.status === 'partial'
  const isSuccess = result.status === 'success'

  return (
    <div className="max-w-[520px]">
      {/* Result header */}
      <div
        className={`mb-5 flex items-start gap-[14px] rounded-[10px] border p-4 ${
          isSuccess
            ? 'border-att-green/25 bg-att-surface'
            : isPartial
              ? 'border-att-orange/25 bg-att-surface'
              : 'border-att-red/25 bg-att-surface'
        }`}
      >
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
            isSuccess
              ? 'bg-att-green/10 text-att-green'
              : isPartial
                ? 'bg-att-orange/10 text-att-orange'
                : 'bg-att-red/10 text-att-red'
          }`}
        >
          {isNotPossible ? (
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          ) : (
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M3 8l4 4 6-7" />
            </svg>
          )}
        </div>
        <div>
          <div className="mb-[3px] text-[14px] font-medium text-foreground">
            {isSuccess
              ? `${result.toolName} — conexión posible`
              : isPartial
                ? `${result.toolName} — conexión posible, con una limitación`
                : `${result.toolName} — conexión no posible automáticamente`}
          </div>
          <div className="text-[12px] leading-[1.5] text-muted-foreground">
            {isNotPossible
              ? 'Esta herramienta requiere acceso privado o acuerdos enterprise que el agente no puede gestionar automáticamente.'
              : 'El agente puede conectarse y ejecutar las acciones descritas.'}
          </div>
        </div>
      </div>

      {/* Capabilities */}
      {result.capabilities.length > 0 && (
        <div className="mb-[18px]">
          <SectionLabel>Lo que el agente puede hacer</SectionLabel>
          <div className="flex flex-col gap-[6px]">
            {result.capabilities.map((cap, i) => (
              <div
                key={i}
                className="flex items-center gap-[10px] rounded-md border border-att-divider bg-att-surface px-3 py-[9px]"
              >
                <div
                  className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[4px] text-[11px] ${CAP_ICON_STYLES[cap.type]}`}
                >
                  {CAP_ICONS[cap.type]}
                </div>
                <span className="flex-1 text-[12px] text-muted-foreground">{cap.name}</span>
                <span
                  className={`shrink-0 rounded-[2px] px-[5px] py-[1px] font-mono text-[8px] ${RISK_STYLES[cap.risk]}`}
                >
                  {RISK_LABELS[cap.risk]}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Auth detail */}
      {result.authType && (
        <div className="mb-[18px]">
          <SectionLabel>Método de autenticación</SectionLabel>
          <div className="rounded-md border border-att-divider bg-att-surface px-[13px] py-[11px]">
            <AuthRow label="Tipo" value={result.authType} className="text-att-green" />
            {result.scopes.length > 0 && (
              <AuthRow label="Scopes" value={result.scopes.join(', ')} />
            )}
            <AuthRow
              label="Webhooks"
              value={
                result.webhooksAvailable
                  ? result.webhookPlan
                    ? `requiere plan ${result.webhookPlan}`
                    : 'disponibles'
                  : 'no disponibles'
              }
              className={
                result.webhooksAvailable && !result.webhookPlan
                  ? 'text-att-green'
                  : 'text-att-orange'
              }
            />
            {result.pollingFallback && (
              <AuthRow
                label="Polling alt."
                value="disponible como alternativa"
                className="text-att-green"
              />
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      {!isNotPossible && (
        <div className="mb-3 flex gap-2">
          <button
            onClick={onConnect}
            className="rounded-[6px] bg-att-blue px-5 py-[9px] font-sans text-[12.5px] font-medium text-white transition-opacity hover:opacity-85"
          >
            Conectar {result.toolName}
          </button>
          <button
            onClick={onRetry}
            className="rounded-[6px] border border-att-divider bg-transparent px-[14px] py-[9px] font-sans text-[12.5px] text-muted-foreground transition-all hover:border-muted-foreground/60 hover:text-foreground"
          >
            Intentar otra herramienta
          </button>
        </div>
      )}

      {isNotPossible && (
        <div className="mb-3 flex gap-2">
          <button
            onClick={onRetry}
            className="rounded-[6px] bg-att-blue px-5 py-[9px] font-sans text-[12.5px] font-medium text-white transition-opacity hover:opacity-85"
          >
            Intentar otra herramienta
          </button>
        </div>
      )}

      {/* Limitation note */}
      {result.limitations && (
        <div className="mt-3 flex gap-[10px] rounded-lg border border-att-orange/20 bg-att-orange/6 p-3">
          <span className="mt-[1px] shrink-0 text-att-orange">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 2a6 6 0 100 12A6 6 0 008 2zm0 9a.75.75 0 110-1.5.75.75 0 010 1.5zm.75-3.25a.75.75 0 01-1.5 0V5.75a.75.75 0 011.5 0v2z" />
            </svg>
          </span>
          <p className="text-[11.5px] leading-[1.5] text-muted-foreground">{result.limitations}</p>
        </div>
      )}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mb-2 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground/60">
      {children}
      <span className="h-px flex-1 bg-att-divider" />
    </div>
  )
}

function AuthRow({
  label,
  value,
  className
}: {
  label: string
  value: string
  className?: string
}): React.JSX.Element {
  return (
    <div className="mb-[6px] flex items-center gap-2 last:mb-0">
      <span className="w-[90px] shrink-0 font-mono text-[9px] text-muted-foreground/60">{label}</span>
      <span className={`text-[12px] text-muted-foreground ${className ?? ''}`}>{value}</span>
    </div>
  )
}
