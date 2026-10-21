import { z } from 'zod';

// Validates the :id in the URL. URL params are always strings, so
// z.coerce turns "5" into the number 5 before checking it.
export const userIdSchema = z.object({
    id: z.coerce
        .number({ error: 'User id must be a number' })
        .int('User id must be a whole number')
        .positive('User id must be greater than 0')
});

// Every field is optional, but at least one must be sent.
// Any other field in the body (like id or created_at) is dropped by Zod.
export const updateUserSchema = z
    .object({
        name: z.string().min(2).max(255).trim().optional(),
        email: z.email().max(255).toLowerCase().trim().optional(),
        password: z.string().min(6).max(128).optional(),
        role: z.enum(['user', 'admin']).optional()
    })
    .refine(data => Object.keys(data).length > 0, {
        message: 'At least one field must be provided to update'
    });
