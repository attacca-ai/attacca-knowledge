import { describe, it, expect } from 'vitest'
import {
  classifyComposioAction,
  classifyAppAction,
  APP_ACTION_RISK_FLOOR,
  HIGH_VERBS,
  LOW_VERBS,
  type RiskTier
} from '@shared/risk-classifier'
import { classifyAction as rendererClassifyAction } from '../permission-engine'

describe('classifyComposioAction — verb-prefix heuristic (main-process parity)', () => {
  it('classifies _DISCOVER_ACTIONS as low', () => {
    expect(classifyComposioAction('_DISCOVER_ACTIONS')).toBe('low')
  })

  it.each(HIGH_VERBS)('classifies verb %s as high', (verb) => {
    expect(classifyComposioAction(`GMAIL_${verb}_EMAIL`)).toBe('high')
  })

  it.each(LOW_VERBS)('classifies verb %s as low', (verb) => {
    expect(classifyComposioAction(`GMAIL_${verb}_EMAILS`)).toBe('low')
  })

  it('classifies CREATE/UPDATE/MODIFY/ARCHIVE/LABEL as medium (default)', () => {
    expect(classifyComposioAction('GMAIL_CREATE_DRAFT')).toBe('medium')
    expect(classifyComposioAction('GMAIL_UPDATE_DRAFT')).toBe('medium')
    expect(classifyComposioAction('GMAIL_MODIFY_MESSAGE')).toBe('medium')
    expect(classifyComposioAction('GMAIL_ARCHIVE_EMAIL')).toBe('medium')
    expect(classifyComposioAction('GMAIL_LABEL_EMAIL')).toBe('medium')
  })

  it('returns the same tier pre/post refactor for every production Composio action', () => {
    // DVR-6 analog: this test pins the exact classification output for every
    // action the agent currently ships. Any drift (because someone accidentally
    // changed the heuristic) shows up here.
    const expected: Record<string, RiskTier> = {
      GMAIL_FETCH_EMAILS: 'low',
      GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID: 'low',
      GMAIL_FETCH_MESSAGE_BY_THREAD_ID: 'low',
      GMAIL_SEND_EMAIL: 'high',
      GMAIL_REPLY_TO_THREAD: 'medium',
      GMAIL_CREATE_EMAIL_DRAFT: 'medium',
      GOOGLECALENDAR_EVENTS_LIST: 'low',
      GOOGLECALENDAR_FIND_EVENT: 'low',
      GOOGLECALENDAR_CREATE_EVENT: 'medium',
      GOOGLECALENDAR_UPDATE_EVENT: 'medium',
      GOOGLECALENDAR_DELETE_EVENT: 'high',
      OUTLOOK_FETCH_EMAILS: 'low',
      OUTLOOK_SEND_EMAIL: 'high',
      OUTLOOK_LIST_EVENTS: 'low',
      OUTLOOK_CREATE_EVENT: 'medium',
      SLACK_LIST_ALL_CHANNELS_IN_THE_SLACK_WORKSPACE: 'low',
      // NOTE: SLACK_SENDS_... uses "SENDS" (plural), which does not match "SEND"
      // in HIGH_VERBS, so the verb-prefix heuristic classifies this as medium.
      // This is pre-existing behavior; Spec B PR B3 will not change it either.
      // The renderer's app-level classifier uses `post.message.channel` for
      // display and correctly tiers it as high, but the main-process gate sees
      // the raw Composio name. Fix candidate for a later spec: add an explicit
      // override map in the shared classifier for this action.
      SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL: 'medium',
      TRELLO_GET_MEMBERS_BOARDS_BY_ID_MEMBER: 'low',
      TRELLO_GET_BOARDS_CARDS_BY_ID_BOARD: 'low',
      TRELLO_UPDATE_CARDS_BY_ID_CARD: 'medium',
      TRELLO_CREATE_CARDS_ACTIONS_COMMENTS_BY_ID_CARD: 'medium',
      CLICKUP_GET_FILTERED_TEAM_TASKS: 'low',
      CLICKUP_GET_SPACES: 'low',
      CLICKUP_GET_FOLDERS: 'low',
      CLICKUP_CREATE_TASK: 'medium',
      CLICKUP_CREATE_CHECKLIST: 'medium',
      CLICKUP_CREATE_CHECKLIST_ITEM: 'medium',
      ASANA_GET_TASKS_LIST: 'low',
      NOTION_SEARCH: 'low',
      GOOGLEDRIVE_LIST_FILES_IN_DRIVE_FOLDER: 'low',
      GOOGLEDRIVE_FIND_FILE: 'low',
      GOOGLEDRIVE_CREATE_FOLDER: 'medium',
      GOOGLEDRIVE_MOVE_FILE: 'medium',
      GOOGLEDRIVE_COPY_FILE: 'medium',
      ONEDRIVE_LIST_ITEMS: 'low',
      ONEDRIVE_SEARCH: 'low',
      ONEDRIVE_CREATE_FOLDER: 'medium',
      ONEDRIVE_MOVE_ITEM: 'medium',
      DROPBOX_LIST_A_FOLDER: 'low',
      DROPBOX_SEARCH_FILES_AND_FOLDERS: 'low',
      DROPBOX_CREATE_A_NEW_FOLDER: 'medium',
      DROPBOX_MOVE_A_FILE_OR_FOLDER: 'medium'
    }

    for (const [action, tier] of Object.entries(expected)) {
      expect(classifyComposioAction(action)).toBe(tier)
    }
  })

  it('preserves base classification for Work/Personal labels (no escalation)', () => {
    expect(classifyComposioAction('GMAIL_FETCH_EMAILS', { label: 'Work' })).toBe('low')
    expect(classifyComposioAction('GMAIL_CREATE_DRAFT', { label: 'Personal' })).toBe('medium')
    expect(classifyComposioAction('GMAIL_SEND_EMAIL', { label: 'Work' })).toBe('high')
  })

  it('DVR-5: Shared label escalates one tier, capped at high', () => {
    // low → medium
    expect(classifyComposioAction('GMAIL_FETCH_EMAILS', { label: 'Shared' })).toBe('medium')
    expect(classifyComposioAction('GOOGLECALENDAR_EVENTS_LIST', { label: 'Shared' })).toBe(
      'medium'
    )
    // medium → high
    expect(classifyComposioAction('GMAIL_CREATE_DRAFT', { label: 'Shared' })).toBe('high')
    expect(classifyComposioAction('GOOGLECALENDAR_CREATE_EVENT', { label: 'Shared' })).toBe('high')
    // high stays high (the cap)
    expect(classifyComposioAction('GMAIL_SEND_EMAIL', { label: 'Shared' })).toBe('high')
    expect(classifyComposioAction('GOOGLECALENDAR_DELETE_EVENT', { label: 'Shared' })).toBe('high')
  })
})

describe('classifyAppAction — app-level floor map (renderer display)', () => {
  it('returns the floor tier for every app-level action in the map', () => {
    for (const [actionType, expectedTier] of Object.entries(APP_ACTION_RISK_FLOOR)) {
      const result = classifyAppAction(actionType)
      expect(result.tier).toBe(expectedTier)
      expect(result.floorTier).toBe(expectedTier)
      expect(result.escalated).toBe(false)
    }
  })

  it('defaults unknown actions to high', () => {
    const result = classifyAppAction('fabricated.unknown.action')
    expect(result.tier).toBe('high')
    expect(result.floorTier).toBe('high')
  })

  it('escalates medium/low to high when shared=true', () => {
    expect(classifyAppAction('create.task', { shared: true }).tier).toBe('high')
    expect(classifyAppAction('read.calendar', { shared: true }).tier).toBe('high')
  })

  it('escalates calendar actions when hasAttendees=true', () => {
    expect(classifyAppAction('create.calendar.personal', { hasAttendees: true }).tier).toBe('high')
  })

  it('does not escalate non-calendar actions on hasAttendees', () => {
    expect(classifyAppAction('create.task', { hasAttendees: true }).tier).toBe('medium')
  })

  it('escalated flag reflects tier vs floor', () => {
    const unescalated = classifyAppAction('send.email')
    expect(unescalated.escalated).toBe(false)

    const escalated = classifyAppAction('create.task', { shared: true })
    expect(escalated.escalated).toBe(true)
  })
})

describe('permission-engine re-export parity', () => {
  it('renderer classifyAction delegates to shared classifyAppAction', () => {
    // Every floor-map entry produces an identical classification via both paths.
    for (const actionType of Object.keys(APP_ACTION_RISK_FLOOR)) {
      const shared = classifyAppAction(actionType)
      const renderer = rendererClassifyAction(actionType)
      expect(renderer).toEqual(shared)
    }
  })

  it('renderer path honors the same context escalation', () => {
    const shared = classifyAppAction('create.task', { shared: true })
    const renderer = rendererClassifyAction('create.task', { shared: true })
    expect(renderer).toEqual(shared)
  })
})
