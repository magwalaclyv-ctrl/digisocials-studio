import { z } from 'zod'

export const postSchema = z.object({
  content: z.string().trim().min(1).max(3000),
  account_ids: z.array(z.string().uuid()).max(20).refine((ids) => new Set(ids).size === ids.length, 'Select each social account only once.'),
  status: z.enum(['draft', 'scheduled']),
  scheduled_at: z.string().datetime({ offset: true }).nullable(),
  media_url: z.string().url().max(2048).refine((value) => /^https?:\/\//i.test(value), 'Image URL must use HTTP or HTTPS.').nullable(),
})
