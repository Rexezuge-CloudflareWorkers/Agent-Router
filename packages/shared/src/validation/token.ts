import { z } from 'zod';

const tokenIdSchema = z.string().trim().uuid('Invalid token id');

export { tokenIdSchema };
