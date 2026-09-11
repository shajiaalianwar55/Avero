import { z } from 'zod';
export const HomeInputSchema = z.object({ label: z.string().trim().min(1).max(100), city: z.string().trim().min(1).max(100), service_area: z.string().trim().min(1).max(100), address: z.string().trim().max(300).optional() }).strict();
export const ProfileInputSchema = z.object({ name: z.string().trim().min(1).max(100) }).strict();
