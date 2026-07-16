import { z } from 'zod';
import { CURRENCIES } from '../../domain/value-objects/Currency.js';

export const createDealInputSchema = z
  .object({
    guildId: z.string().min(1),
    ticketChannelId: z.string().min(1),
    currency: z.enum(CURRENCIES),
    buyerDiscordId: z.string().min(1),
    sellerDiscordId: z.string().min(1),
    expectedAmountDecimal: z.string().regex(/^\d+(\.\d+)?$/),
    feeBasisPoints: z.number().int().min(0).max(10_000),
  })
  .refine((input) => input.buyerDiscordId !== input.sellerDiscordId, {
    message: 'Buyer and seller must be different Discord users',
    path: ['sellerDiscordId'],
  });

export type CreateDealInput = z.infer<typeof createDealInputSchema>;
