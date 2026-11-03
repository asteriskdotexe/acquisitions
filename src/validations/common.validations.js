import { z } from 'zod';

// Money stored as numeric(12,2): positive, at most 2 decimals, and at most
// 9999999999.99. The value is turned into a string with exactly 2 decimals,
// which is how Postgres numeric round-trips. label is used in the messages.
export const priceSchema = label =>
  z.coerce
    .number({ error: `${label} must be a number` })
    .positive(`${label} must be greater than 0`)
    .max(9999999999.99, `${label} must be at most 9999999999.99`)
    .multipleOf(0.01, `${label} can have at most 2 decimal places`)
    .transform(price => price.toFixed(2));
