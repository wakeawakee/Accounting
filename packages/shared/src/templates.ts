export type TemplateType = 'reminder' | 'due_today';
export type Language = 'ne' | 'en';

export const TEMPLATE_TYPES: TemplateType[] = ['reminder', 'due_today'];
export const TEMPLATE_VARIABLES = ['clientName', 'firmName', 'period', 'dueDateBs', 'uploadLink'] as const;
export type TemplateVars = Record<(typeof TEMPLATE_VARIABLES)[number], string>;

export const DEFAULT_TEMPLATES: Record<TemplateType, Record<Language, string>> = {
  reminder: {
    ne: 'नमस्ते {clientName} जी, {firmName} बाट सम्झना: {period} को बिलहरू {dueDateBs} भित्र पठाउनुहोस्। यहाँ अपलोड गर्नुहोस्: {uploadLink}',
    en: 'Hi {clientName}, reminder from {firmName}: please send your {period} bills by {dueDateBs}. Upload here: {uploadLink}',
  },
  due_today: {
    ne: '{clientName} जी, {period} को बिल पठाउने अन्तिम दिन आज ({dueDateBs}) हो। {firmName}: {uploadLink}',
    en: '{clientName}, today ({dueDateBs}) is the last day to send your {period} bills. {firmName}: {uploadLink}',
  },
};

export function renderTemplate(body: string, vars: Partial<TemplateVars>): string {
  return body.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k as keyof TemplateVars] ?? '') : m));
}

export const SAMPLE_TEMPLATE_VARS: TemplateVars = {
  clientName: 'Ram Bahadur',
  firmName: 'Sharma Accounts',
  period: '2083 Kartik',
  dueDateBs: '2083-08-25',
  uploadLink: 'https://ks.np/u/Ab12Cd34Ef56',
};
