import { z } from 'zod';

export const TEMPLATE_PLACEHOLDERS = [
  'mentions',
  'update_number',
  'update_name',
  'missing_count',
  'team_name',
  'date',
] as const;

const placeholderSet = new Set<string>(TEMPLATE_PLACEHOLDERS);
const placeholderPattern = /\{([a-z_]+)\}/g;

export function validateTemplate(template: string): string[] {
  const unknown = new Set<string>();
  for (const match of template.matchAll(placeholderPattern)) {
    const name = match[1];
    if (name && !placeholderSet.has(name)) unknown.add(name);
  }
  return [...unknown].sort();
}

export function renderTemplate(
  template: string,
  values: Partial<Record<(typeof TEMPLATE_PLACEHOLDERS)[number], string | number>>,
): string {
  const unknown = validateTemplate(template);
  if (unknown.length > 0) throw new Error(`Unknown template placeholder(s): ${unknown.join(', ')}`);
  return template.replace(placeholderPattern, (_full, name: string) =>
    String(values[name as keyof typeof values] ?? ''),
  );
}

export const templateUpdateSchema = z
  .object({
    initialReminder: z.string().min(1).max(4000),
    escalationReminder: z.string().min(1).max(4000),
    finalCaption: z.string().min(1).max(900),
  })
  .superRefine((value, context) => {
    for (const [field, template] of Object.entries(value)) {
      for (const placeholder of validateTemplate(template)) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: `Unknown placeholder: {${placeholder}}`,
        });
      }
    }
  });
