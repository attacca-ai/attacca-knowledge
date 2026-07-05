import { useState, useEffect, useCallback, useRef } from 'react'
import { useTaskStore, type AgentTask } from '@/stores/task-store'
import { useProjectStore, type Project } from '@/stores/project-store'
import { useTranslation } from '@/i18n'
import { cn } from '@/lib/utils'
import { Loader2, RefreshCw, ExternalLink, ChevronRight, AlertCircle, Plus, Send, CheckCircle2, Circle, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// ── Types ────────────────────────────────────────────────────────────────────

interface ClickUpTask {
  id: string
  name: string
  description: string
  status: { status: string; type: string }
  priority: { priority: string } | null
  assignees: Array<{ username: string; profilePicture?: string }>
  due_date: string | null
  url: string
  date_created: string
  date_updated: string
  list: { name: string } | null
  folder?: { name: string } | null
  space?: { id: string; name?: string } | null
  tags: Array<{ name: string }>
  subtasks?: ClickUpTask[]
  time_estimate?: number | null
  custom_fields?: Array<{ name: string; value?: unknown }>
}

interface ClickUpComment {
  id: string
  comment_text: string
  comment?: Array<{ text: string }>
  user: { username: string; profilePicture?: string }
  date: string
}

type TaskTab = 'local' | 'projects' | 'clickup'
type LocalFilter = 'all' | 'pending' | 'in_progress' | 'completed'

// ── Helpers ──────────────────────────────────────────────────────────────────

function localStatusColor(status: string): string {
  switch (status) {
    case 'pending': return 'bg-att-blue/20 text-att-blue'
    case 'in_progress': return 'bg-att-orange/20 text-att-orange'
    case 'completed': return 'bg-att-green/20 text-att-green'
    case 'failed': return 'bg-att-red/20 text-att-red'
    default: return 'bg-muted text-muted-foreground'
  }
}

function localStatusIcon(status: string): React.JSX.Element {
  switch (status) {
    case 'completed': return <CheckCircle2 className="h-3 w-3 text-att-green" />
    case 'in_progress': return <Loader2 className="h-3 w-3 animate-spin text-att-orange" />
    case 'failed': return <AlertCircle className="h-3 w-3 text-att-red" />
    default: return <Circle className="h-3 w-3 text-att-blue" />
  }
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return ''
  const d = new Date(Number(dateStr))
  if (isNaN(d.getTime())) return ''
  const now = new Date()
  const diff = d.getTime() - now.getTime()
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24))
  if (days < 0) return `${Math.abs(days)}d overdue`
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  return `${days}d`
}

// ── Component ────────────────────────────────────────────────────────────────

export function TasksView(): React.JSX.Element {
  const { t } = useTranslation()
  const [isClickUpConnectedState, setIsClickUpConnectedState] = useState(false)
  const localTasks = useTaskStore((s) => s.localTasks)
  const addLocalTask = useTaskStore((s) => s.addLocalTask)
  const updateLocalTask = useTaskStore((s) => s.updateLocalTask)
  const projects = useProjectStore((s) => s.projects)
  const addProject = useProjectStore((s) => s.addProject)
  const addTaskToProject = useProjectStore((s) => s.addTaskToProject)
  const isClickUpConnected = isClickUpConnectedState

  useEffect(() => {
    let cancelled = false
    window.api.clickup
      .status()
      .then((s) => {
        if (!cancelled) setIsClickUpConnectedState(Boolean(s?.connected))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const [tab, setTab] = useState<TaskTab>('local')
  const [clickUpTasks, setClickUpTasks] = useState<ClickUpTask[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [localFilter, setLocalFilter] = useState<LocalFilter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedType, setSelectedType] = useState<'local' | 'clickup'>('local')
  const [lastSynced, setLastSynced] = useState<Date | null>(null)
  const [showNewTask, setShowNewTask] = useState(false)
  const [newTaskInput, setNewTaskInput] = useState('')
  const [showNewProject, setShowNewProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectDesc, setNewProjectDesc] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)

  // ── ClickUp fetch ────────────────────────────────────────────────────────

  const fetchClickUp = useCallback(async () => {
    if (!isClickUpConnected) return
    setLoading(true)
    setError(null)
    try {
      // Direct ClickUp API — no Composio, no action discovery needed
      const teamsRes = await window.api.clickup.callAction('CLICKUP_AUTHORIZATION_GET_WORK_SPACE_LIST', {})
      if (!teamsRes.success) throw new Error(teamsRes.error ?? 'Failed to fetch workspaces')

      const teams = (teamsRes.result as { teams?: Array<{ id: string }> })?.teams ?? []
      const teamId = teams[0]?.id
      if (!teamId) throw new Error('No ClickUp workspace found — check your API token in Settings → Connections')

      const tasksRes = await window.api.clickup.callAction('CLICKUP_GET_FILTERED_TEAM_TASKS', {
        team_id: teamId,
        include_closed: false
      })
      if (!tasksRes.success || !tasksRes.result) throw new Error(tasksRes.error ?? 'Failed to fetch tasks')

      const result = tasksRes.result as { tasks?: ClickUpTask[] }
      setClickUpTasks(result.tasks ?? [])
      setLastSynced(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [isClickUpConnected])

  useEffect(() => {
    if (isClickUpConnected && tab === 'clickup' && clickUpTasks.length === 0 && !loading) {
      fetchClickUp()
    }
  }, [isClickUpConnected, tab, fetchClickUp, clickUpTasks.length, loading])

  // ── Local task creation ──────────────────────────────────────────────────

  const handleCreateTask = (): void => {
    if (!newTaskInput.trim()) return
    const id = addLocalTask({ description: newTaskInput.trim(), sourceType: 'manual' })
    setNewTaskInput('')
    setShowNewTask(false)
    setTab('local')
    setSelectedProjectId(null)
    setSelectedId(id)
    setSelectedType('local')
  }

  const handleCreateProject = (): void => {
    if (!newProjectName.trim()) return
    const id = addProject({ name: newProjectName.trim(), description: newProjectDesc.trim() })
    setNewProjectName('')
    setNewProjectDesc('')
    setShowNewProject(false)
    setSelectedProjectId(id)
    setTab('projects')
  }

  const selectedProject = projects.find((p) => p.id === selectedProjectId)
  const projectTasks = selectedProject
    ? localTasks.filter((t) => selectedProject.taskIds.includes(t.id))
    : []

  // ── Filtered lists ───────────────────────────────────────────────────────

  const filteredLocal = localTasks.filter((t) => {
    if (localFilter === 'all') return true
    return t.status === localFilter
  })

  const selectedLocal = localTasks.find((t) => t.id === selectedId)
  const selectedClickUp = clickUpTasks.find((t) => t.id === selectedId)

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full">
      {/* Left panel */}
      <div className="flex w-[380px] shrink-0 flex-col border-r border-att-divider">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-att-divider px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">{t('tasks.title')}</h2>
          <Button variant="ghost" size="icon-xs" onClick={() => setShowNewTask(true)} title="New task">
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* New task input */}
        {showNewTask && (
          <div className="flex gap-2 border-b border-att-divider px-4 py-2">
            <Input
              value={newTaskInput}
              onChange={(e) => setNewTaskInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateTask(); if (e.key === 'Escape') setShowNewTask(false) }}
              placeholder="What needs to be done?"
              className="text-xs"
              autoFocus
            />
            <Button size="sm" onClick={handleCreateTask} disabled={!newTaskInput.trim()}>Add</Button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-att-divider">
          <button
            onClick={() => setTab('local')}
            className={cn(
              'flex-1 py-2 text-center text-[11px] font-medium transition-colors',
              tab === 'local' ? 'border-b-2 border-att-blue text-att-blue' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Tasks ({localTasks.length})
          </button>
          <button
            onClick={() => setTab('projects')}
            className={cn(
              'flex-1 py-2 text-center text-[11px] font-medium transition-colors',
              tab === 'projects' ? 'border-b-2 border-att-blue text-att-blue' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Projects ({projects.filter((p) => p.status === 'active').length})
          </button>
          {isClickUpConnected && (
            <button
              onClick={() => setTab('clickup')}
              className={cn(
                'flex-1 py-2 text-center text-[11px] font-medium transition-colors',
                tab === 'clickup' ? 'border-b-2 border-att-blue text-att-blue' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              ClickUp ({clickUpTasks.length})
              {loading && <Loader2 className="ml-1 inline h-3 w-3 animate-spin" />}
            </button>
          )}
        </div>

        {/* Filter (local tab only) */}
        {tab === 'local' && (
          <div className="flex gap-1 border-b border-att-divider px-4 py-2">
            {(['all', 'pending', 'in_progress', 'completed'] as LocalFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setLocalFilter(f)}
                className={cn(
                  'rounded-md px-2 py-1 text-[11px] transition-colors',
                  localFilter === f
                    ? 'bg-att-blue/12 text-att-blue'
                    : 'text-muted-foreground hover:bg-muted/30'
                )}
              >
                {f === 'in_progress' ? 'Active' : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        )}

        {/* Task list */}
        <div className="flex-1 overflow-auto">
          {tab === 'projects' ? (
            /* Projects tab */
            <>
              {showNewProject && (
                <div className="border-b border-att-divider px-4 py-3">
                  <Input
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleCreateProject(); if (e.key === 'Escape') setShowNewProject(false) }}
                    placeholder="Project name"
                    className="mb-2 text-xs"
                    autoFocus
                  />
                  <Input
                    value={newProjectDesc}
                    onChange={(e) => setNewProjectDesc(e.target.value)}
                    placeholder="Description (optional)"
                    className="mb-2 text-xs"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleCreateProject} disabled={!newProjectName.trim()}>Create</Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowNewProject(false)}>Cancel</Button>
                  </div>
                </div>
              )}
              {projects.filter((p) => p.status === 'active').length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12 px-4 text-center">
                  <p className="text-sm text-muted-foreground">No projects yet</p>
                  <Button variant="outline" size="sm" onClick={() => setShowNewProject(true)}>
                    <Plus className="mr-1 h-3 w-3" /> Create project
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col">
                  {!showNewProject && (
                    <button
                      onClick={() => setShowNewProject(true)}
                      className="flex items-center gap-2 border-b border-att-divider px-4 py-2 text-[11px] text-att-blue hover:bg-muted/20"
                    >
                      <Plus className="h-3 w-3" /> New project
                    </button>
                  )}
                  {projects.filter((p) => p.status === 'active').map((project) => (
                    <button
                      key={project.id}
                      onClick={() => { setSelectedProjectId(project.id); setSelectedId(null); setSelectedType('local') }}
                      className={cn(
                        'flex flex-col gap-1 border-b border-att-divider px-4 py-3 text-left transition-colors',
                        selectedProjectId === project.id && tab === 'projects'
                          ? 'bg-att-blue/6'
                          : 'hover:bg-muted/20'
                      )}
                    >
                      <p className="text-[12.5px] font-medium text-foreground">{project.name}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground/50">
                          {project.taskIds.length} tasks
                        </span>
                        <span className="text-[10px] text-muted-foreground/50">
                          {project.contextFiles.length} files
                        </span>
                        <span className="text-[10px] text-muted-foreground/40">
                          {timeAgo(new Date(project.createdAt))}
                        </span>
                      </div>
                      {project.description && (
                        <p className="truncate text-[11px] text-muted-foreground/60">{project.description}</p>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : tab === 'local' ? (
            filteredLocal.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 px-4 text-center">
                <p className="text-sm text-muted-foreground">No tasks yet</p>
                <Button variant="outline" size="sm" onClick={() => setShowNewTask(true)}>
                  <Plus className="mr-1 h-3 w-3" /> Create a task
                </Button>
              </div>
            ) : (
              <div className="flex flex-col">
                {filteredLocal.map((task) => (
                  <button
                    key={task.id}
                    onClick={() => { setSelectedId(task.id); setSelectedType('local') }}
                    className={cn(
                      'flex items-center gap-3 border-b border-att-divider px-4 py-3 text-left transition-colors',
                      selectedId === task.id && selectedType === 'local'
                        ? 'bg-att-blue/6'
                        : 'hover:bg-muted/20'
                    )}
                  >
                    {localStatusIcon(task.status)}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-medium text-foreground">{task.description}</p>
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-medium uppercase', localStatusColor(task.status))}>
                          {task.status.replace('_', ' ')}
                        </span>
                        {task.sourceType && task.sourceType !== 'manual' && (
                          <span className="text-[9px] text-muted-foreground/50">from {task.sourceType}</span>
                        )}
                        <span className="text-[10px] text-muted-foreground/40">{timeAgo(new Date(task.createdAt))}</span>
                      </div>
                    </div>
                    <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                  </button>
                ))}
              </div>
            )
          ) : (
            /* ClickUp tab */
            loading && clickUpTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                <p className="text-xs text-muted-foreground">{t('tasks.loading')}</p>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12 px-4 text-center">
                <AlertCircle className="h-5 w-5 text-att-red" />
                <p className="text-[11px] text-muted-foreground">{error}</p>
                <Button variant="outline" size="sm" onClick={fetchClickUp}>{t('tasks.retry')}</Button>
              </div>
            ) : clickUpTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12">
                <p className="text-sm text-muted-foreground">{t('tasks.empty')}</p>
                <Button variant="outline" size="sm" onClick={fetchClickUp}>
                  <RefreshCw className="mr-1 h-3 w-3" /> Sync
                </Button>
              </div>
            ) : (
              <div className="flex flex-col">
                {clickUpTasks.map((task) => (
                  <button
                    key={task.id}
                    onClick={() => { setSelectedId(task.id); setSelectedType('clickup') }}
                    className={cn(
                      'flex flex-col gap-1.5 border-b border-att-divider px-4 py-3 text-left transition-colors',
                      selectedId === task.id && selectedType === 'clickup'
                        ? 'bg-att-blue/6'
                        : 'hover:bg-muted/20'
                    )}
                  >
                    <p className="text-[12.5px] font-medium text-foreground">{task.name}</p>
                    <div className="flex items-center gap-1.5">
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium uppercase text-muted-foreground">
                        {task.status?.status ?? 'unknown'}
                      </span>
                      {task.list?.name && (
                        <span className="ml-auto truncate text-[10px] text-muted-foreground/50">{task.list.name}</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )
          )}
        </div>

        {/* Footer */}
        {tab === 'clickup' && lastSynced && (
          <div className="flex items-center justify-between border-t border-att-divider px-4 py-2">
            <p className="text-[10px] text-muted-foreground/50">Synced {timeAgo(lastSynced)}</p>
            <Button variant="ghost" size="icon-xs" onClick={fetchClickUp} disabled={loading}>
              <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
            </Button>
          </div>
        )}
      </div>

      {/* Right: Detail + Chat */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {tab === 'projects' && selectedProject ? (
          <ProjectDetail project={selectedProject} tasks={projectTasks} onAddTask={(desc) => {
            const id = addLocalTask({ description: desc, sourceType: 'manual' })
            addTaskToProject(selectedProject.id, id)
          }} />
        ) : selectedType === 'local' && selectedLocal && selectedLocal.id ? (
          <LocalTaskDetail key={selectedLocal.id} task={selectedLocal} onUpdate={updateLocalTask} />
        ) : selectedType === 'clickup' && selectedClickUp ? (
          <ClickUpTaskDetail task={selectedClickUp} />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-muted-foreground/50">Select a task or project to view details</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Local Task Detail + Agent Chat ───────────────────────────────────────────

function LocalTaskDetail({
  task,
  onUpdate
}: {
  task: AgentTask | undefined
  onUpdate: (id: string, update: Partial<AgentTask>) => void
}): React.JSX.Element {
  const taskId = task?.id ?? ''
  const chatMessages = useTaskStore((s) => s.taskChatMessages[taskId] ?? [])
  const addChatMessage = useTaskStore((s) => s.addTaskChatMessage)
  const project = useProjectStore((s) =>
    task?.projectId ? s.projects.find((p) => p.id === task.projectId) : undefined
  )
  const [chatInput, setChatInput] = useState('')
  const [sending, setSending] = useState(false)
  const pendingRef = useRef<string | null>(null)
  const chatBottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages.length])

  // Listen for agent responses
  useEffect(() => {
    if (!taskId) return
    const unsub = window.api.agent.onFinal((data) => {
      if (!pendingRef.current || data.sessionKey !== pendingRef.current) return
      pendingRef.current = null
      setSending(false)
      if (data.message) addChatMessage(taskId, { role: 'agent', text: data.message, ts: Date.now() })
    })
    // Agent errors arrive as events — without this the "sending" bubble is stuck forever
    const unsubError = window.api.agent.onError((data) => {
      if (!pendingRef.current || data.sessionKey !== pendingRef.current) return
      pendingRef.current = null
      setSending(false)
      addChatMessage(taskId, {
        role: 'agent',
        text: data.error || 'Something went wrong. Please try again.',
        ts: Date.now()
      })
    })
    return () => {
      unsub()
      unsubError()
    }
  }, [taskId, addChatMessage])

  if (!task) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground/50">Task not found</p>
      </div>
    )
  }

  const handleSend = async (): Promise<void> => {
    if (!chatInput.trim() || sending) return
    const userText = chatInput.trim()
    setChatInput('')
    addChatMessage(task.id, { role: 'user', text: userText, ts: Date.now() })
    setSending(true)

    const sessionKey = `agent:main:task-${task.id}-${crypto.randomUUID()}`
    pendingRef.current = sessionKey

    const projectContext = project
      ? `\nProject: "${project.name}" — ${project.description}${project.contextFiles.length > 0 ? `\nContext files: ${project.contextFiles.map((f) => f.fileName).join(', ')}` : ''}`
      : ''
    const prompt = `You are helping the user execute a task.\n\nTask: "${task.description}"\nStatus: ${task.status}\n${task.sourceType ? `Source: ${task.sourceType}` : ''}${projectContext}\n\nUser says: "${userText}"\n\nHelp them make progress. Use tools if needed. Be concise and actionable.`

    try {
      await window.api.agent.send(sessionKey, prompt, sessionKey)
    } catch {
      setSending(false)
      pendingRef.current = null
    }
  }

  const statusActions = task.status === 'pending'
    ? [{ label: 'Start', status: 'in_progress' as const }]
    : task.status === 'in_progress'
      ? [{ label: 'Complete', status: 'completed' as const }]
      : []

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-att-divider px-6 py-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h2 className="text-base font-semibold text-foreground">{task.description}</h2>
            <div className="mt-2 flex items-center gap-2">
              <span className={cn('rounded px-2 py-0.5 text-[10px] font-medium uppercase', localStatusColor(task.status))}>
                {task.status.replace('_', ' ')}
              </span>
              {project && (
                <span className="rounded bg-att-purple/10 px-2 py-0.5 text-[10px] text-att-purple">
                  {project.name}
                </span>
              )}
              {task.sourceType && task.sourceType !== 'manual' && (
                <span className="rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                  from {task.sourceType}
                </span>
              )}
              <span className="text-[10px] text-muted-foreground/40">
                <Clock className="mr-0.5 inline h-2.5 w-2.5" />
                {timeAgo(new Date(task.createdAt))}
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            {statusActions.map((a) => (
              <Button key={a.status} size="sm" variant="outline" onClick={() => onUpdate(task.id, { status: a.status })}>
                {a.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Agent chat */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="border-b border-att-divider px-6 py-2">
          <p className="font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground/50">Agent Chat</p>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-auto px-6 py-4">
          {chatMessages.length === 0 ? (
            <p className="text-xs text-muted-foreground/40">Ask the agent to help you execute this task.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {chatMessages.map((msg, i) => (
                <div key={i} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <div className={cn(
                    'max-w-[80%] rounded-lg px-3 py-2 text-xs leading-relaxed',
                    msg.role === 'user'
                      ? 'bg-att-blue text-white'
                      : 'bg-att-surface-hover text-foreground/80'
                  )}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex justify-start">
                  <div className="rounded-lg bg-att-surface-hover px-3 py-2">
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                  </div>
                </div>
              )}
              <div ref={chatBottomRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <div className="shrink-0 border-t border-att-divider px-6 py-3">
          <div className="flex gap-2">
            <Input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              placeholder="Ask the agent..."
              className="text-xs"
              disabled={false}
            />
            <Button size="icon-xs" onClick={handleSend} disabled={!chatInput.trim() || sending}>
              <Send className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── ClickUp Task Detail ──────────────────────────────────────────────────────

function ClickUpTaskDetail({ task }: { task: ClickUpTask }): React.JSX.Element | null {
  const addChatMessage = useTaskStore((s) => s.addTaskChatMessage)
  const taskKey = `cu_${task?.id ?? 'none'}`
  const chatMessages = useTaskStore((s) => s.taskChatMessages[taskKey] ?? [])
  const [comments, setComments] = useState<ClickUpComment[]>([])
  const [loadingComments, setLoadingComments] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [sending, setSending] = useState(false)
  const pendingRef = useRef<string | null>(null)
  const chatBottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages.length])

  // Fetch comments on mount
  useEffect(() => {
    if (!task?.id) return
    let cancelled = false
    setLoadingComments(true)
    window.api.clickup.callAction('CLICKUP_GET_TASK_COMMENTS', { task_id: String(task.id) })
      .then((res) => {
        if (cancelled) return
        if (res.success && res.result) {
          const data = res.result as { comments?: ClickUpComment[] }
          setComments(Array.isArray(data.comments) ? data.comments : [])
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoadingComments(false) })
    return () => { cancelled = true }
  }, [task?.id])

  // Listen for agent responses
  useEffect(() => {
    if (!task?.id) return
    const unsub = window.api.agent.onFinal((data) => {
      if (!pendingRef.current || data.sessionKey !== pendingRef.current) return
      pendingRef.current = null
      setSending(false)
      if (data.message) addChatMessage(taskKey, { role: 'agent', text: data.message, ts: Date.now() })
    })
    // Agent errors arrive as events — without this the "sending" bubble is stuck forever
    const unsubError = window.api.agent.onError((data) => {
      if (!pendingRef.current || data.sessionKey !== pendingRef.current) return
      pendingRef.current = null
      setSending(false)
      addChatMessage(taskKey, {
        role: 'agent',
        text: data.error || 'Something went wrong. Please try again.',
        ts: Date.now()
      })
    })
    return () => {
      unsub()
      unsubError()
    }
  }, [task?.id, taskKey, addChatMessage])

  if (!task) return null

  const handleSend = async (prefill?: string): Promise<void> => {
    const userText = (prefill ?? chatInput).trim()
    if (!userText || sending) return
    if (!prefill) setChatInput('')
    addChatMessage(taskKey, { role: 'user', text: userText, ts: Date.now() })
    setSending(true)

    const sessionKey = `agent:main:task-${task.id}-${crypto.randomUUID()}`
    pendingRef.current = sessionKey

    const subtasks = task.subtasks ?? []
    const subtaskInfo = subtasks.length
      ? `\nSubtasks:\n${subtasks.map((s) => `- [${s.status?.status ?? '?'}] ${s.name}`).join('\n')}`
      : ''
    const commentTexts = comments.slice(0, 5).map((c) => {
      const text = c.comment_text || c.comment?.map((p) => p.text).join('') || ''
      return `- ${c.user?.username ?? 'unknown'}: ${text.slice(0, 200)}`
    })
    const commentInfo = commentTexts.length ? `\nRecent comments:\n${commentTexts.join('\n')}` : ''
    const assigneeNames = (task.assignees ?? []).map((a) => a?.username ?? '').filter(Boolean).join(', ') || 'Unassigned'

    const prompt = `You are helping the user work on a ClickUp task.\n\nTask: "${task.name ?? ''}"\nStatus: ${task.status?.status ?? 'unknown'}\nList: ${task.list?.name ?? 'Unknown'}\nFolder: ${task.folder?.name ?? 'Unknown'}\nAssignees: ${assigneeNames}\nDue: ${task.due_date ? new Date(Number(task.due_date)).toLocaleDateString() : 'No due date'}\nDescription: ${task.description || 'None'}${subtaskInfo}${commentInfo}\n\nUser says: "${userText}"\n\nHelp them make progress on this task. Be concise and actionable. Use tools if needed.`

    try {
      await window.api.agent.send(sessionKey, prompt, sessionKey)
    } catch {
      setSending(false)
      pendingRef.current = null
    }
  }

  const quickActions = [
    { label: 'Break down this task', prompt: 'Break this task into concrete next steps I can execute right now.' },
    { label: 'Draft a response', prompt: 'Draft a comment or update for this task based on its current state.' },
    { label: 'Find blockers', prompt: 'What might be blocking progress on this task? Check for dependencies or missing info.' }
  ]

  const status = task.status?.status ?? 'unknown'
  const assignees = (task.assignees ?? []).map((a) => a?.username ?? '').filter(Boolean).join(', ') || 'Unassigned'
  const tags = task.tags ?? []
  const subtasks = task.subtasks ?? []

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-att-divider px-6 py-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <h2 className="text-base font-semibold text-foreground">{task.name ?? 'Untitled'}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                {status}
              </span>
              {task.priority?.priority && (
                <span className="rounded bg-att-orange/10 px-2 py-0.5 text-[10px] font-medium text-att-orange">
                  {task.priority.priority}
                </span>
              )}
              {tags.map((tag, i) => (
                <span key={tag?.name ?? i} className="rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                  {tag?.name ?? ''}
                </span>
              ))}
            </div>
          </div>
          {task.url && (
            <Button variant="ghost" size="icon-xs" onClick={() => window.api.app.openExternal(task.url)} title="Open in ClickUp">
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Metadata grid */}
      <div className="shrink-0 grid grid-cols-3 gap-3 border-b border-att-divider px-6 py-3">
        <CUMeta label="Assignee" value={assignees} />
        <CUMeta label="Due" value={formatDate(task.due_date) || 'No due date'} />
        <CUMeta label="List" value={task.list?.name ?? '—'} />
        {task.folder?.name ? <CUMeta label="Folder" value={task.folder.name} /> : null}
        {task.space?.name ? <CUMeta label="Space" value={task.space.name} /> : null}
        {typeof task.time_estimate === 'number' && task.time_estimate > 0 ? <CUMeta label="Estimate" value={`${Math.round(task.time_estimate / 3600000)}h`} /> : null}
      </div>

      {/* Scrollable content area */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-auto px-6 py-4">
          {/* Description */}
          {task.description ? (
            <div className="mb-4">
              <CUSection>Description</CUSection>
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/80">{task.description}</p>
            </div>
          ) : null}

          {/* Subtasks */}
          {subtasks.length > 0 ? (
            <div className="mb-4">
              <CUSection>Subtasks ({subtasks.length})</CUSection>
              <div className="flex flex-col gap-1">
                {subtasks.map((sub, i) => (
                  <div key={sub?.id ?? i} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/20">
                    {sub?.status?.type === 'closed'
                      ? <CheckCircle2 className="h-3 w-3 shrink-0 text-att-green" />
                      : <Circle className="h-3 w-3 shrink-0 text-muted-foreground/40" />}
                    <span className={cn('flex-1 text-xs', sub?.status?.type === 'closed' && 'text-muted-foreground/50 line-through')}>
                      {sub?.name ?? ''}
                    </span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[8px] uppercase text-muted-foreground">
                      {sub?.status?.status ?? '—'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Comments */}
          <div className="mb-4">
            <CUSection>Comments {loadingComments ? <Loader2 className="ml-1 inline h-3 w-3 animate-spin" /> : null}</CUSection>
            {comments.length === 0 && !loadingComments ? (
              <p className="text-xs text-muted-foreground/40">No comments</p>
            ) : (
              <div className="flex flex-col gap-2">
                {comments.map((c, i) => {
                  const text = c?.comment_text || c?.comment?.map((p) => p?.text ?? '').join('') || ''
                  return (
                    <div key={c?.id ?? i} className="rounded-md border border-att-divider bg-att-surface px-3 py-2">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="text-[11px] font-medium text-foreground">{c?.user?.username ?? 'Unknown'}</span>
                        <span className="text-[10px] text-muted-foreground/40">{c?.date ? timeAgo(new Date(Number(c.date))) : ''}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-foreground/70">{text}</p>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Quick actions */}
          <div className="mb-4">
            <CUSection>Work on this task</CUSection>
            <div className="flex flex-wrap gap-1.5">
              {quickActions.map((action) => (
                <button
                  key={action.label}
                  onClick={() => handleSend(action.prompt)}
                  disabled={sending}
                  className="rounded-md border border-att-divider bg-att-surface px-3 py-1.5 text-[11px] text-muted-foreground transition-all hover:border-att-blue hover:text-att-blue disabled:opacity-40"
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>

          {/* Agent chat messages */}
          {chatMessages.length > 0 ? (
            <div className="mb-2">
              <CUSection>Agent</CUSection>
              <div className="flex flex-col gap-2">
                {chatMessages.map((msg, i) => (
                  <div key={i} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                    <div className={cn(
                      'max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed',
                      msg.role === 'user'
                        ? 'bg-att-blue text-white'
                        : 'bg-att-surface-hover text-foreground/80'
                    )}>
                      {msg.text}
                    </div>
                  </div>
                ))}
                {sending ? (
                  <div className="flex justify-start">
                    <div className="rounded-lg bg-att-surface-hover px-3 py-2">
                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    </div>
                  </div>
                ) : null}
                <div ref={chatBottomRef} />
              </div>
            </div>
          ) : null}
        </div>

        {/* Chat input */}
        <div className="shrink-0 border-t border-att-divider px-6 py-3">
          <div className="flex gap-2">
            <Input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              placeholder="Ask the agent about this task..."
              className="text-xs"
            />
            <Button size="icon-xs" onClick={() => handleSend()} disabled={!chatInput.trim() || sending}>
              <Send className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function CUMeta({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase text-muted-foreground/50">{label}</p>
      <p className="mt-0.5 text-xs text-foreground">{value}</p>
    </div>
  )
}

function CUSection({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p className="mb-2 font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground/50">{children}</p>
  )
}

// ── Project Detail ───────────────────────────────────────────────────────────

function ProjectDetail({
  project,
  tasks,
  onAddTask
}: {
  project: Project
  tasks: AgentTask[]
  onAddTask: (description: string) => void
}): React.JSX.Element {
  const [newTaskInput, setNewTaskInput] = useState('')

  return (
    <div className="flex flex-col overflow-auto">
      {/* Header */}
      <div className="border-b border-att-divider px-6 py-4">
        <h2 className="text-base font-semibold text-foreground">{project.name}</h2>
        {project.description && (
          <p className="mt-1 text-xs text-muted-foreground">{project.description}</p>
        )}
        <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground/50">
          <span>{project.taskIds.length} tasks</span>
          <span>{project.contextFiles.length} files</span>
          <span>Created {timeAgo(new Date(project.createdAt))}</span>
        </div>
      </div>

      {/* Add task to project */}
      <div className="flex gap-2 border-b border-att-divider px-6 py-3">
        <Input
          value={newTaskInput}
          onChange={(e) => setNewTaskInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newTaskInput.trim()) {
              onAddTask(newTaskInput.trim())
              setNewTaskInput('')
            }
          }}
          placeholder="Add a task to this project..."
          className="text-xs"
        />
        <Button
          size="sm"
          disabled={!newTaskInput.trim()}
          onClick={() => { onAddTask(newTaskInput.trim()); setNewTaskInput('') }}
        >
          Add
        </Button>
      </div>

      {/* Tasks in project */}
      <div className="px-6 py-4">
        <p className="mb-2 font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground/50">Tasks</p>
        {tasks.length === 0 ? (
          <p className="text-xs text-muted-foreground/40">No tasks in this project yet.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {tasks.map((task) => (
              <div key={task.id} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/20">
                {localStatusIcon(task.status)}
                <span className="flex-1 truncate text-xs text-foreground">{task.description}</span>
                <span className={cn('rounded px-1.5 py-0.5 text-[8px] font-medium uppercase', localStatusColor(task.status))}>
                  {task.status.replace('_', ' ')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Context files */}
      {project.contextFiles.length > 0 && (
        <div className="border-t border-att-divider px-6 py-4">
          <p className="mb-2 font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground/50">Context Files</p>
          <div className="flex flex-col gap-1">
            {project.contextFiles.map((file) => (
              <div key={file.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="flex-1 truncate">{file.fileName}</span>
                <span className="text-[10px] text-muted-foreground/40">
                  {(file.sizeBytes / 1024).toFixed(1)}KB
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
