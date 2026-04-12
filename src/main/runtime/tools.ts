/**
 * Native Anthropic tool definitions for the Attacca agent runtime.
 * Maps short tool names to Composio action names with minimal schemas.
 * ~80-120 tokens per tool vs ~500+ for MCP schemas.
 */

import type Anthropic from '@anthropic-ai/sdk'

interface ToolMapping {
  composioAction: string
  risk: 'low' | 'medium' | 'high'
  definition: Anthropic.Tool
}

/**
 * All tool mappings, grouped by toolkit.
 * Only tools for connected toolkits are included in the API request.
 */
const TOOL_REGISTRY: Record<string, ToolMapping[]> = {
  gmail: [
    {
      composioAction: 'GMAIL_FETCH_EMAILS',
      risk: 'low',
      definition: {
        name: 'search_emails',
        description: 'Search Gmail emails by query',
        input_schema: {
          type: 'object' as const,
          properties: {
            query: { type: 'string', description: 'Gmail search query (e.g. "is:unread", "from:name@example.com")' },
            max_results: { type: 'integer', description: 'Max results to return (default 20)' }
          },
          required: ['query']
        }
      }
    },
    {
      composioAction: 'GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID',
      risk: 'low',
      definition: {
        name: 'get_email',
        description: 'Get a specific email by message ID',
        input_schema: {
          type: 'object' as const,
          properties: { message_id: { type: 'string', description: 'Gmail message ID' } },
          required: ['message_id']
        }
      }
    },
    {
      composioAction: 'GMAIL_FETCH_MESSAGE_BY_THREAD_ID',
      risk: 'low',
      definition: {
        name: 'get_email_thread',
        description: 'Get all messages in an email thread',
        input_schema: {
          type: 'object' as const,
          properties: { thread_id: { type: 'string', description: 'Gmail thread ID' } },
          required: ['thread_id']
        }
      }
    },
    {
      composioAction: 'GMAIL_SEND_EMAIL',
      risk: 'high',
      definition: {
        name: 'send_email',
        description: 'Send a new email via Gmail',
        input_schema: {
          type: 'object' as const,
          properties: {
            recipient_email: { type: 'string', description: 'Recipient email address' },
            subject: { type: 'string', description: 'Email subject' },
            body: { type: 'string', description: 'Email body' },
            is_html: { type: 'boolean', description: 'Whether body is HTML (default false)' }
          },
          required: ['recipient_email', 'subject', 'body']
        }
      }
    },
    {
      composioAction: 'GMAIL_REPLY_TO_THREAD',
      risk: 'high',
      definition: {
        name: 'reply_to_email',
        description: 'Reply to an existing email thread',
        input_schema: {
          type: 'object' as const,
          properties: {
            thread_id: { type: 'string', description: 'Thread ID to reply to' },
            body: { type: 'string', description: 'Reply body' },
            recipient_email: { type: 'string', description: 'Recipient email' },
            is_html: { type: 'boolean', description: 'Whether body is HTML' }
          },
          required: ['thread_id', 'body', 'recipient_email']
        }
      }
    },
    {
      composioAction: 'GMAIL_CREATE_EMAIL_DRAFT',
      risk: 'medium',
      definition: {
        name: 'draft_email',
        description: 'Create an email draft',
        input_schema: {
          type: 'object' as const,
          properties: {
            recipient_email: { type: 'string', description: 'Recipient email' },
            subject: { type: 'string', description: 'Subject' },
            body: { type: 'string', description: 'Body' }
          },
          required: ['recipient_email', 'subject', 'body']
        }
      }
    }
  ],

  googlecalendar: [
    {
      composioAction: 'GOOGLECALENDAR_EVENTS_LIST',
      risk: 'low',
      definition: {
        name: 'list_calendar_events',
        description: 'List Google Calendar events in a time range',
        input_schema: {
          type: 'object' as const,
          properties: {
            calendarId: { type: 'string', description: 'Calendar ID (default: "primary")' },
            timeMin: { type: 'string', description: 'Start time (ISO 8601)' },
            timeMax: { type: 'string', description: 'End time (ISO 8601)' },
            singleEvents: { type: 'boolean', description: 'Expand recurring (default true)' },
            orderBy: { type: 'string', description: 'Order (default "startTime")' }
          },
          required: ['timeMin', 'timeMax']
        }
      }
    },
    {
      composioAction: 'GOOGLECALENDAR_FIND_EVENT',
      risk: 'low',
      definition: {
        name: 'find_calendar_event',
        description: 'Search Google Calendar events by query',
        input_schema: {
          type: 'object' as const,
          properties: {
            calendarId: { type: 'string', description: 'Calendar ID' },
            query: { type: 'string', description: 'Search text' },
            timeMin: { type: 'string', description: 'Start time (ISO 8601)' }
          },
          required: ['query']
        }
      }
    },
    {
      composioAction: 'GOOGLECALENDAR_CREATE_EVENT',
      risk: 'medium',
      definition: {
        name: 'create_calendar_event',
        description: 'Create a Google Calendar event',
        input_schema: {
          type: 'object' as const,
          properties: {
            summary: { type: 'string', description: 'Event title' },
            start_datetime: { type: 'string', description: 'Start (ISO 8601 with offset)' },
            end_datetime: { type: 'string', description: 'End (ISO 8601 with offset)' },
            timeZone: { type: 'string', description: 'IANA timezone (e.g. America/Bogota)' },
            description: { type: 'string', description: 'Event description' },
            attendees: { type: 'array', items: { type: 'string' }, description: 'Attendee emails' }
          },
          required: ['summary', 'start_datetime', 'end_datetime', 'timeZone']
        }
      }
    },
    {
      composioAction: 'GOOGLECALENDAR_UPDATE_EVENT',
      risk: 'medium',
      definition: {
        name: 'update_calendar_event',
        description: 'Update an existing Google Calendar event',
        input_schema: {
          type: 'object' as const,
          properties: {
            eventId: { type: 'string', description: 'Event ID' },
            summary: { type: 'string', description: 'Updated title' },
            start_datetime: { type: 'string', description: 'Updated start' },
            end_datetime: { type: 'string', description: 'Updated end' },
            timeZone: { type: 'string', description: 'IANA timezone' },
            attendees: { type: 'array', items: { type: 'string' }, description: 'Updated attendees' }
          },
          required: ['eventId']
        }
      }
    },
    {
      composioAction: 'GOOGLECALENDAR_DELETE_EVENT',
      risk: 'high',
      definition: {
        name: 'delete_calendar_event',
        description: 'Delete a Google Calendar event',
        input_schema: {
          type: 'object' as const,
          properties: {
            calendarId: { type: 'string', description: 'Calendar ID' },
            eventId: { type: 'string', description: 'Event ID to delete' }
          },
          required: ['eventId']
        }
      }
    }
  ],

  outlook: [
    {
      composioAction: 'OUTLOOK_FETCH_EMAILS',
      risk: 'low',
      definition: {
        name: 'list_outlook_emails',
        description: 'List Outlook emails',
        input_schema: {
          type: 'object' as const,
          properties: {
            folder: { type: 'string', description: 'Folder (default "inbox")' },
            top: { type: 'integer', description: 'Max results' }
          },
          required: []
        }
      }
    },
    {
      composioAction: 'OUTLOOK_SEND_EMAIL',
      risk: 'high',
      definition: {
        name: 'send_outlook_email',
        description: 'Send an email via Outlook',
        input_schema: {
          type: 'object' as const,
          properties: {
            subject: { type: 'string', description: 'Subject' },
            body: { type: 'string', description: 'Body' },
            to: { type: 'array', items: { type: 'string' }, description: 'Recipients' }
          },
          required: ['subject', 'body', 'to']
        }
      }
    },
    {
      composioAction: 'OUTLOOK_LIST_EVENTS',
      risk: 'low',
      definition: {
        name: 'list_outlook_events',
        description: 'List Outlook calendar events',
        input_schema: {
          type: 'object' as const,
          properties: {
            timeMin: { type: 'string', description: 'Start time (ISO 8601)' },
            timeMax: { type: 'string', description: 'End time (ISO 8601)' }
          },
          required: []
        }
      }
    },
    {
      composioAction: 'OUTLOOK_CREATE_EVENT',
      risk: 'medium',
      definition: {
        name: 'create_outlook_event',
        description: 'Create an Outlook calendar event',
        input_schema: {
          type: 'object' as const,
          properties: {
            subject: { type: 'string', description: 'Event title' },
            start: { type: 'string', description: 'Start (ISO 8601 with offset)' },
            end: { type: 'string', description: 'End (ISO 8601 with offset)' },
            timeZone: { type: 'string', description: 'IANA timezone' }
          },
          required: ['subject', 'start', 'end']
        }
      }
    }
  ],

  slack: [
    {
      composioAction: 'SLACK_LIST_ALL_CHANNELS_IN_THE_SLACK_WORKSPACE',
      risk: 'low',
      definition: {
        name: 'list_slack_channels',
        description: 'List all Slack channels in the workspace',
        input_schema: { type: 'object' as const, properties: {}, required: [] }
      }
    },
    {
      composioAction: 'SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL',
      risk: 'high',
      definition: {
        name: 'send_slack_message',
        description: 'Send a message to a Slack channel',
        input_schema: {
          type: 'object' as const,
          properties: {
            channel: { type: 'string', description: 'Channel name or ID (e.g. "#general")' },
            text: { type: 'string', description: 'Message text' }
          },
          required: ['channel', 'text']
        }
      }
    }
  ],

  trello: [
    {
      composioAction: 'TRELLO_GET_MEMBERS_BOARDS_BY_ID_MEMBER',
      risk: 'low',
      definition: {
        name: 'list_trello_boards',
        description: 'List Trello boards for the authenticated user',
        input_schema: {
          type: 'object' as const,
          properties: { idMember: { type: 'string', description: 'Member ID (use "me")' } },
          required: []
        }
      }
    },
    {
      composioAction: 'TRELLO_GET_BOARDS_CARDS_BY_ID_BOARD',
      risk: 'low',
      definition: {
        name: 'list_trello_cards',
        description: 'List cards on a Trello board',
        input_schema: {
          type: 'object' as const,
          properties: { idBoard: { type: 'string', description: 'Board ID' } },
          required: ['idBoard']
        }
      }
    },
    {
      composioAction: 'TRELLO_UPDATE_CARDS_BY_ID_CARD',
      risk: 'medium',
      definition: {
        name: 'update_trello_card',
        description: 'Update a Trello card (name, description, list, etc.)',
        input_schema: {
          type: 'object' as const,
          properties: {
            idCard: { type: 'string', description: 'Card ID' },
            name: { type: 'string', description: 'New card name' },
            closed: { type: 'boolean', description: 'Archive the card' }
          },
          required: ['idCard']
        }
      }
    },
    {
      composioAction: 'TRELLO_CREATE_CARDS_ACTIONS_COMMENTS_BY_ID_CARD',
      risk: 'medium',
      definition: {
        name: 'comment_trello_card',
        description: 'Add a comment to a Trello card',
        input_schema: {
          type: 'object' as const,
          properties: {
            idCard: { type: 'string', description: 'Card ID' },
            text: { type: 'string', description: 'Comment text' }
          },
          required: ['idCard', 'text']
        }
      }
    }
  ],

  clickup: [
    {
      composioAction: 'CLICKUP_AUTHORIZATION_GET_WORK_SPACE_LIST',
      risk: 'low',
      definition: {
        name: 'list_clickup_workspaces',
        description: 'List ClickUp workspaces',
        input_schema: { type: 'object' as const, properties: {}, required: [] }
      }
    },
    {
      composioAction: 'CLICKUP_GET_SPACES',
      risk: 'low',
      definition: {
        name: 'list_clickup_spaces',
        description: 'List spaces in a ClickUp workspace',
        input_schema: {
          type: 'object' as const,
          properties: { team_id: { type: 'string', description: 'Workspace/team ID' } },
          required: ['team_id']
        }
      }
    },
    {
      composioAction: 'CLICKUP_GET_FOLDERS',
      risk: 'low',
      definition: {
        name: 'list_clickup_folders',
        description: 'List folders in a ClickUp space',
        input_schema: {
          type: 'object' as const,
          properties: { space_id: { type: 'string', description: 'Space ID' } },
          required: ['space_id']
        }
      }
    },
    {
      composioAction: 'CLICKUP_GET_FILTERED_TEAM_TASKS',
      risk: 'low',
      definition: {
        name: 'list_clickup_tasks',
        description: 'List tasks in a ClickUp workspace',
        input_schema: {
          type: 'object' as const,
          properties: {
            team_id: { type: 'string', description: 'Workspace/team ID' },
            statuses: { type: 'array', items: { type: 'string' }, description: 'Filter by status' }
          },
          required: ['team_id']
        }
      }
    },
    {
      composioAction: 'CLICKUP_CREATE_TASK',
      risk: 'medium',
      definition: {
        name: 'create_clickup_task',
        description: 'Create a new ClickUp task',
        input_schema: {
          type: 'object' as const,
          properties: {
            list_id: { type: 'string', description: 'List ID' },
            name: { type: 'string', description: 'Task name' },
            description: { type: 'string', description: 'Task description' }
          },
          required: ['list_id', 'name']
        }
      }
    },
    {
      composioAction: 'CLICKUP_CREATE_CHECKLIST',
      risk: 'medium',
      definition: {
        name: 'create_clickup_checklist',
        description: 'Create a checklist on a ClickUp task',
        input_schema: {
          type: 'object' as const,
          properties: {
            task_id: { type: 'string', description: 'Task ID' },
            name: { type: 'string', description: 'Checklist name' }
          },
          required: ['task_id', 'name']
        }
      }
    },
    {
      composioAction: 'CLICKUP_CREATE_CHECKLIST_ITEM',
      risk: 'medium',
      definition: {
        name: 'create_clickup_checklist_item',
        description: 'Add an item to a ClickUp checklist',
        input_schema: {
          type: 'object' as const,
          properties: {
            checklist_id: { type: 'string', description: 'Checklist ID' },
            name: { type: 'string', description: 'Item name' }
          },
          required: ['checklist_id', 'name']
        }
      }
    }
  ],

  asana: [
    {
      composioAction: 'ASANA_GET_TASKS_LIST',
      risk: 'low',
      definition: {
        name: 'list_asana_tasks',
        description: 'List Asana tasks assigned to user',
        input_schema: {
          type: 'object' as const,
          properties: {
            assignee: { type: 'string', description: 'Assignee (default "me")' },
            completed_since: { type: 'string', description: 'Filter (default "now" for incomplete)' }
          },
          required: []
        }
      }
    }
  ],

  notion: [
    {
      composioAction: 'NOTION_SEARCH',
      risk: 'low',
      definition: {
        name: 'search_notion',
        description: 'Search Notion pages and databases',
        input_schema: {
          type: 'object' as const,
          properties: {
            query: { type: 'string', description: 'Search query' },
            filter: { type: 'object', description: 'Filter object (e.g. {"value":"page","property":"object"})' }
          },
          required: []
        }
      }
    }
  ],

  googledrive: [
    {
      composioAction: 'GOOGLEDRIVE_LIST_FILES_IN_DRIVE_FOLDER',
      risk: 'low',
      definition: {
        name: 'list_drive_files',
        description: 'List files in a Google Drive folder',
        input_schema: {
          type: 'object' as const,
          properties: { folder_id: { type: 'string', description: 'Folder ID (default "root")' } },
          required: []
        }
      }
    },
    {
      composioAction: 'GOOGLEDRIVE_FIND_FILE',
      risk: 'low',
      definition: {
        name: 'search_drive_files',
        description: 'Search Google Drive files',
        input_schema: {
          type: 'object' as const,
          properties: { search_query: { type: 'string', description: 'Search query' } },
          required: ['search_query']
        }
      }
    },
    {
      composioAction: 'GOOGLEDRIVE_CREATE_FOLDER',
      risk: 'medium',
      definition: {
        name: 'create_drive_folder',
        description: 'Create a folder in Google Drive',
        input_schema: {
          type: 'object' as const,
          properties: {
            name: { type: 'string', description: 'Folder name' },
            parent_folder_id: { type: 'string', description: 'Parent folder ID' }
          },
          required: ['name']
        }
      }
    },
    {
      composioAction: 'GOOGLEDRIVE_MOVE_FILE',
      risk: 'medium',
      definition: {
        name: 'move_drive_file',
        description: 'Move a Google Drive file',
        input_schema: {
          type: 'object' as const,
          properties: {
            file_id: { type: 'string', description: 'File ID' },
            new_parent_folder_id: { type: 'string', description: 'Destination folder ID' }
          },
          required: ['file_id', 'new_parent_folder_id']
        }
      }
    },
    {
      composioAction: 'GOOGLEDRIVE_COPY_FILE',
      risk: 'low',
      definition: {
        name: 'copy_drive_file',
        description: 'Copy a Google Drive file',
        input_schema: {
          type: 'object' as const,
          properties: {
            file_id: { type: 'string', description: 'File ID' },
            new_name: { type: 'string', description: 'Name for the copy' }
          },
          required: ['file_id']
        }
      }
    }
  ],

  one_drive: [
    {
      composioAction: 'ONEDRIVE_LIST_ITEMS',
      risk: 'low',
      definition: {
        name: 'list_onedrive_files',
        description: 'List OneDrive files',
        input_schema: {
          type: 'object' as const,
          properties: { path: { type: 'string', description: 'Path (default "/")' } },
          required: []
        }
      }
    },
    {
      composioAction: 'ONEDRIVE_SEARCH',
      risk: 'low',
      definition: {
        name: 'search_onedrive',
        description: 'Search OneDrive files',
        input_schema: {
          type: 'object' as const,
          properties: { search_text: { type: 'string', description: 'Search query' } },
          required: ['search_text']
        }
      }
    },
    {
      composioAction: 'ONEDRIVE_CREATE_FOLDER',
      risk: 'medium',
      definition: {
        name: 'create_onedrive_folder',
        description: 'Create a OneDrive folder',
        input_schema: {
          type: 'object' as const,
          properties: {
            folder_name: { type: 'string', description: 'Folder name' },
            parent_path: { type: 'string', description: 'Parent path' }
          },
          required: ['folder_name']
        }
      }
    },
    {
      composioAction: 'ONEDRIVE_MOVE_ITEM',
      risk: 'medium',
      definition: {
        name: 'move_onedrive_item',
        description: 'Move a OneDrive item',
        input_schema: {
          type: 'object' as const,
          properties: {
            item_id: { type: 'string', description: 'Item ID' },
            destination_path: { type: 'string', description: 'Destination path' }
          },
          required: ['item_id', 'destination_path']
        }
      }
    }
  ],

  dropbox: [
    {
      composioAction: 'DROPBOX_LIST_A_FOLDER',
      risk: 'low',
      definition: {
        name: 'list_dropbox_files',
        description: 'List files in a Dropbox folder',
        input_schema: {
          type: 'object' as const,
          properties: { path: { type: 'string', description: 'Folder path (empty for root)' } },
          required: []
        }
      }
    },
    {
      composioAction: 'DROPBOX_SEARCH_FILES_AND_FOLDERS',
      risk: 'low',
      definition: {
        name: 'search_dropbox',
        description: 'Search Dropbox files',
        input_schema: {
          type: 'object' as const,
          properties: { query: { type: 'string', description: 'Search query' } },
          required: ['query']
        }
      }
    },
    {
      composioAction: 'DROPBOX_CREATE_A_NEW_FOLDER',
      risk: 'medium',
      definition: {
        name: 'create_dropbox_folder',
        description: 'Create a Dropbox folder',
        input_schema: {
          type: 'object' as const,
          properties: { path: { type: 'string', description: 'Folder path' } },
          required: ['path']
        }
      }
    },
    {
      composioAction: 'DROPBOX_MOVE_A_FILE_OR_FOLDER',
      risk: 'medium',
      definition: {
        name: 'move_dropbox_item',
        description: 'Move a Dropbox file or folder',
        input_schema: {
          type: 'object' as const,
          properties: {
            from_path: { type: 'string', description: 'Source path' },
            to_path: { type: 'string', description: 'Destination path' }
          },
          required: ['from_path', 'to_path']
        }
      }
    }
  ]
}

/** Map frontend tool IDs to toolkit registry keys */
const TOOL_ID_TO_TOOLKIT: Record<string, string> = {
  gmail: 'gmail',
  'google-calendar': 'googlecalendar',
  googlecalendar: 'googlecalendar',
  outlook: 'outlook',
  'outlook-email': 'outlook',
  'outlook-calendar': 'outlook',
  slack: 'slack',
  trello: 'trello',
  clickup: 'clickup',
  asana: 'asana',
  notion: 'notion',
  'google-drive': 'googledrive',
  googledrive: 'googledrive',
  onedrive: 'one_drive',
  one_drive: 'one_drive',
  dropbox: 'dropbox'
}

/** Reverse map: Anthropic tool name → Composio action name */
const toolNameToAction = new Map<string, string>()

// Build reverse map + augment every Composio tool definition with an optional
// `connectionId` parameter (Spec B PR B3). Agents can pass this when the user
// explicitly says "from my personal gmail". Augmentation happens once at module
// load so we don't mutate shared schemas on every request.
for (const tools of Object.values(TOOL_REGISTRY)) {
  for (const tool of tools) {
    toolNameToAction.set(tool.definition.name, tool.composioAction)
    const schema = tool.definition.input_schema as {
      type: 'object'
      properties?: Record<string, unknown>
      required?: string[]
    }
    if (!schema.properties) schema.properties = {}
    schema.properties.connectionId = {
      type: 'string',
      description:
        'Optional: connection id to target a specific connected account. Omit to use the default account for this toolkit.'
    }
  }
}

/** Memory tools — always included regardless of connected tools */
const MEMORY_TOOLS: Anthropic.Tool[] = [
  {
    name: 'memory_search',
    description: "Search user's memory for past decisions, preferences, events, or context",
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query — use keywords about the topic' }
      },
      required: ['query']
    }
  },
  {
    name: 'memory_save',
    description: 'Save a user preference, decision, or important context for future reference',
    input_schema: {
      type: 'object' as const,
      properties: {
        content: { type: 'string', description: 'What to remember' },
        type: {
          type: 'string',
          enum: ['preference', 'decision', 'capture'],
          description: 'Type of memory'
        },
        summary: { type: 'string', description: 'One-line summary' }
      },
      required: ['content', 'type', 'summary']
    }
  }
]

/**
 * Human-readable summary of each toolkit, returned by `list_available_toolkits`.
 * Candidate C (goal-oriented) copy — see .attacca/spec-a.md AMB-1 resolution.
 */
export const TOOLKIT_SUMMARIES: Record<string, { name: string; what: string }> = {
  gmail: { name: 'Gmail', what: 'Email — search, read, compose, reply, organize' },
  googlecalendar: {
    name: 'Google Calendar',
    what: 'Calendar — list events, create/reschedule meetings, check availability'
  },
  outlook: { name: 'Outlook', what: 'Email + Calendar — Outlook inbox and meetings' },
  slack: { name: 'Slack', what: 'Messaging — send to channels, list conversations' },
  trello: { name: 'Trello', what: 'Tasks — boards, cards, lists' },
  clickup: {
    name: 'ClickUp',
    what: 'Project management — tasks, lists, folders, goals'
  },
  asana: { name: 'Asana', what: 'Tasks — projects and to-dos' },
  notion: { name: 'Notion', what: 'Docs — pages, databases, blocks' },
  googledrive: { name: 'Google Drive', what: 'Files — search, read, upload to Google Drive' },
  one_drive: { name: 'OneDrive', what: 'Files — search, read, upload to OneDrive' },
  dropbox: { name: 'Dropbox', what: 'Files — search, read, upload to Dropbox' }
}

/** Router meta-tools — always included in `main` sessions to drive two-stage loading */
const ROUTER_TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_available_toolkits',
    description:
      "Discover the external capabilities currently available to you. Returns the user's connected toolkits (e.g. Gmail, Google Calendar, Slack) with a brief summary of each. Use this whenever the user asks about email, scheduling, messaging, documents, or anything that lives outside this conversation.",
    input_schema: { type: 'object' as const, properties: {} }
  },
  {
    name: 'load_toolkit',
    description:
      "Unlock a toolkit's actions so you can call them. Before you can send an email, read a calendar, or post to Slack, first load the relevant toolkit by its slug. Once loaded, the toolkit stays available for the rest of this conversation — you do not need to re-load it. If the toolkit you need isn't connected, the call returns an error with the list of what IS connected; in that case, tell the user what they need to connect and offer to help them do it.",
    input_schema: {
      type: 'object' as const,
      properties: {
        slug: {
          type: 'string',
          description:
            'Toolkit slug to load (e.g. "gmail", "googlecalendar", "slack", "trello", "notion")'
        }
      },
      required: ['slug']
    }
  }
]

/**
 * Normalize a slug (frontend tool ID or Composio slug) to the canonical registry key.
 * Returns the lowercased original string if no mapping exists.
 */
export function normalizeToolkitSlug(slug: string): string {
  const lower = slug.toLowerCase()
  return TOOL_ID_TO_TOOLKIT[lower] ?? lower
}

/**
 * Build the Anthropic tools array for a `feature` session — includes ALL connected
 * toolkits' tools upfront plus memory tools. Single-turn UX, no meta-tool routing.
 * This is the pre-A4 behavior preserved for feature sessions.
 */
export function buildToolDefinitions(connectedTools: string[]): Anthropic.Tool[] {
  const tools: Anthropic.Tool[] = [...MEMORY_TOOLS]
  const seen = new Set<string>(MEMORY_TOOLS.map((t) => t.name))

  for (const toolId of connectedTools) {
    const registryKey = normalizeToolkitSlug(toolId)
    const mappings = TOOL_REGISTRY[registryKey]
    if (!mappings) continue

    for (const mapping of mappings) {
      if (seen.has(mapping.definition.name)) continue
      seen.add(mapping.definition.name)
      tools.push(mapping.definition)
    }
  }

  return tools
}

/**
 * Build the Anthropic tools array for a `main` session using two-stage routing.
 * Always includes: memory tools + router meta-tools. Toolkit tools are included
 * only for toolkits the agent has explicitly loaded via `load_toolkit`.
 */
export function buildToolDefinitionsForMain(loadedToolkits: Set<string>): Anthropic.Tool[] {
  const tools: Anthropic.Tool[] = [...MEMORY_TOOLS, ...ROUTER_TOOLS]
  const seen = new Set<string>(tools.map((t) => t.name))

  for (const toolId of loadedToolkits) {
    const registryKey = normalizeToolkitSlug(toolId)
    const mappings = TOOL_REGISTRY[registryKey]
    if (!mappings) continue

    for (const mapping of mappings) {
      if (seen.has(mapping.definition.name)) continue
      seen.add(mapping.definition.name)
      tools.push(mapping.definition)
    }
  }

  return tools
}

/**
 * Resolve an Anthropic tool name to its Composio action name.
 * Returns undefined if the tool name is not recognized.
 */
export function resolveComposioAction(toolName: string): string | undefined {
  return toolNameToAction.get(toolName)
}

/**
 * Return the Anthropic tool names (not Composio action names) for a given toolkit.
 * Used by `load_toolkit` so the agent knows what it can now call.
 */
export function getToolkitActionNames(toolkitSlug: string): string[] {
  const registryKey = normalizeToolkitSlug(toolkitSlug)
  const mappings = TOOL_REGISTRY[registryKey]
  if (!mappings) return []
  return mappings.map((m) => m.definition.name)
}

/**
 * Check if a tool name is an internal tool (not a Composio action).
 * Internal tools are handled directly by the runtime: memory tools read/write
 * SQLite; router meta-tools read/mutate session state. None go through the gate.
 */
export function isInternalTool(toolName: string): boolean {
  return (
    toolName === 'memory_search' ||
    toolName === 'memory_save' ||
    toolName === 'list_available_toolkits' ||
    toolName === 'load_toolkit'
  )
}
