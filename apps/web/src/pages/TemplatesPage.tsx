import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { renderTemplate, smsSegments, TEMPLATE_VARIABLES } from '@karsathi/shared';
import { api } from '../lib/api';
import { ErrorText, PageTitle } from '../components/ui';

function TemplateEditor({ tpl, sampleVars }: { tpl: any; sampleVars: Record<string, string> }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [body, setBody] = useState(tpl.body);
  const [saved, setSaved] = useState(false);
  useEffect(() => setBody(tpl.body), [tpl.body]);
  const preview = renderTemplate(body, sampleVars);
  const seg = smsSegments(preview);
  const save = useMutation({
    mutationFn: (b: string) => api(`/templates/${tpl.type}/${tpl.language}`, { method: 'PUT', body: { body: b } }),
    onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2000); void qc.invalidateQueries({ queryKey: ['templates'] }); },
  });
  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-medium">{t(`templates.${tpl.type}`)} · {tpl.language === 'ne' ? 'नेपाली' : 'English'}</h3>
        {tpl.isDefault && <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{t('templates.isDefault')}</span>}
      </div>
      <textarea className="input font-mono" rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
      <div className="mt-1 flex flex-wrap gap-1">
        {TEMPLATE_VARIABLES.map((v) => (
          <button key={v} type="button" className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs hover:bg-slate-200" onClick={() => setBody(body + `{${v}}`)}>{`{${v}}`}</button>
        ))}
      </div>
      <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
        <div className="label">{t('templates.preview')}</div>
        <p className="whitespace-pre-wrap">{preview}</p>
        <p className={`mt-2 text-xs ${seg.segments > 2 ? 'text-red-600' : seg.segments > 1 ? 'text-amber-700' : 'text-slate-500'}`}>
          {t('templates.chars', { n: seg.length })} · {t('templates.segments', { n: seg.segments })} · {seg.encoding}
        </p>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button className="btn-primary" onClick={() => save.mutate(body)} disabled={save.isPending || body === tpl.body}>{t('common.save')}</button>
        {!tpl.isDefault && <button className="btn-secondary" onClick={() => { setBody(tpl.defaultBody); save.mutate(tpl.defaultBody); }}>{t('templates.reset')}</button>}
        {saved && <span className="text-sm text-green-700">{t('common.saved')}</span>}
      </div>
      <ErrorText error={save.error} />
    </div>
  );
}

export default function TemplatesPage() {
  const { t } = useTranslation();
  const { data } = useQuery({ queryKey: ['templates'], queryFn: () => api('/templates') });
  return (
    <div>
      <PageTitle>{t('templates.title')}</PageTitle>
      <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">ℹ {t('templates.unicodeNote')}</p>
      <div className="grid gap-4 lg:grid-cols-2">
        {data?.templates.map((tpl: any) => <TemplateEditor key={`${tpl.type}-${tpl.language}`} tpl={tpl} sampleVars={data.sampleVars} />)}
      </div>
    </div>
  );
}
