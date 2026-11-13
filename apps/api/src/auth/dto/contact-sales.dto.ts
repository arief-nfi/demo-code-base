import { z } from 'zod';

export const contactSalesSchema = z.object({
  companyName: z.string().min(2, 'Company name is required'),
  contactName: z.string().min(2, 'Contact name is required'),
  email: z.string().email('Invalid email address'),
  phone: z.string().min(5, 'Phone number is required'),
  employees: z.string().min(1, 'Company size is required'),
  message: z.string().optional(),
});

export type ContactSalesDto = z.infer<typeof contactSalesSchema>;
