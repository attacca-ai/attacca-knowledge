/**
 * Default areas offered during onboarding (spec §6.2). Six defaults,
 * pre-checked. User must select ≥1 to advance (resolved Q3).
 */
export interface AreaDefault {
  name: string
  emoji: string
  description: string
}

export const DEFAULT_AREAS: AreaDefault[] = [
  {
    name: 'Health',
    emoji: '🏃',
    description: 'Physical activity, sleep, nutrition, medical'
  },
  {
    name: 'Career',
    emoji: '💼',
    description: 'Work, side projects, professional growth'
  },
  {
    name: 'Family & Relationships',
    emoji: '❤️',
    description: 'Partner, family, close friends'
  },
  {
    name: 'Finance',
    emoji: '💰',
    description: 'Income, spending, saving, investments'
  },
  {
    name: 'Learning',
    emoji: '📚',
    description: 'Books, courses, research, skill building'
  },
  {
    name: 'Personal Projects',
    emoji: '🛠️',
    description: 'Hobbies, side interests, crafts'
  }
]
