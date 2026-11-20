/**
 * Public client upload page (/u/:token).
 * Kept deliberately tiny: no i18next, no react-query, no zod — loads fast on 3G.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DEMO } from '../lib/demo';
import { BS_MONTHS_EN, BS_MONTHS_NE, toNepaliDigits } from '@karsathi/shared/bsDate';

type Lang = 'ne' | 'en';
const T = {
  ne: {
    hello: 'नमस्ते',
    requested: 'कृपया यस अवधिका बिल/कागजात पठाउनुहोस्:',
    due: 'अन्तिम मिति',
    takePhoto: 'फोटो खिच्नुहोस्',
    chooseFile: 'फाइल छान्नुहोस्',
    upload: 'पठाउनुहोस्',
    uploading: 'पठाउँदै…',
    preparing: 'तयार गर्दै…',
    selected: 'छानिएका फाइल',
    remove: 'हटाउनुहोस्',
    done: 'धन्यवाद! तपाईंका कागजात प्राप्त भए।',
    more: 'अरू थप्नुहोस्',
    already: 'यस अवधिका लागि पहिले नै पठाइएका फाइल',
    hint: 'JPG, PNG वा PDF · प्रति फाइल अधिकतम १० MB',
    tooBig: 'फाइल धेरै ठूलो छ (अधिकतम १० MB)',
    badType: 'JPG, PNG वा PDF मात्र',
    error: 'केही गडबड भयो। फेरि प्रयास गर्नुहोस्।',
    note: 'सन्देश (ऐच्छिक)',
    questions: 'प्रश्न भए सम्पर्क गर्नुहोस्',
  },
  en: {
    hello: 'Hello',
    requested: 'Please send your bills/documents for:',
    due: 'Due by',
    takePhoto: 'Take photo',
    chooseFile: 'Choose file',
    upload: 'Send',
    uploading: 'Sending…',
    preparing: 'Preparing…',
    selected: 'Selected files',
    remove: 'Remove',
    done: 'Thank you! Your documents were received.',
    more: 'Add more',
    already: 'Files already sent for this period',
    hint: 'JPG, PNG or PDF · max 10 MB per file',
    tooBig: 'File too large (max 10 MB)',
    badType: 'Only JPG, PNG or PDF',
    error: 'Something went wrong. Please try again.',
    note: 'Message (optional)',
    questions: 'Questions? Call',
  },
};

interface Info {
  firm: { name: string; phone: string; hasLogo: boolean };
  client: { businessName: string; ownerName: string; preferredLanguage: Lang };
  task: { ruleName: { en: string; ne: string }; periodLabel: string; periodLabelNe: string; dueDateBs: string; status: string };
  uploadedCount: number;
}

const MAX_BYTES = 10 * 1024 * 1024;
const TARGET_BYTES = 1024 * 1024;

function formatBs(s: string, lang: Lang) {
  const [y, m, d] = s.split('-').map(Number);
  return lang === 'ne' ? `${toNepaliDigits(y)} ${BS_MONTHS_NE[m - 1]} ${toNepaliDigits(d)}` : `${d} ${BS_MONTHS_EN[m - 1]} ${y}`;
}

/** Resize + re-encode images in the browser so each is < ~1 MB. PDFs pass through. */
async function compressImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.size <= TARGET_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file);
    let maxSide = 1800;
    let quality = 0.75;
    for (let i = 0; i < 5; i++) {
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality));
      if (blob && blob.size <= TARGET_BYTES) return blob;
      maxSide *= 0.8;
      quality -= 0.1;
    }
  } catch {
    /* fall through: send original */
  }
  return file;
}

function uploadWithProgress(url: string, form: FormData, onProgress: (p: number) => void): Promise<void> {
  if (DEMO) {
    onProgress(0.5);
    return fetch(url, { method: 'POST', body: form, headers: { 'X-Requested-With': 'karsathi' } }).then(async (r) => {
      if (!r.ok) throw new Error((await r.json()).error);
      onProgress(1);
    });
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('X-Requested-With', 'karsathi');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        let msg = '';
        try {
          msg = JSON.parse(xhr.responseText).error;
        } catch {
          /* ignore */
        }
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error(''));
    xhr.send(form);
  });
}

export default function UploadPage() {
  const { token } = useParams();
  const base = `${import.meta.env.VITE_API_URL ?? ''}/api/public/u/${token}`;
  const [info, setInfo] = useState<Info | null>(null);
  const [loadError, setLoadError] = useState('');
  const [lang, setLang] = useState<Lang>('ne');
  const [files, setFiles] = useState<{ file: File; preview?: string; error?: string }[]>([]);
  const [note, setNote] = useState('');
  const [phase, setPhase] = useState<'idle' | 'preparing' | 'uploading' | 'done'>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const t = T[lang];

  useEffect(() => {
    fetch(base)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setInfo(d);
        setLang(d.client.preferredLanguage === 'en' ? 'en' : 'ne');
      })
      .catch((e) => setLoadError(e.message || 'Link not found'));
  }, [base]);

  useEffect(() => () => files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview)), [files]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const added = [...list].map((file) => {
      const okType = /^(image\/(jpeg|png|heic|heif|webp)|application\/pdf)$/.test(file.type) || /\.(jpe?g|png|pdf)$/i.test(file.name);
      const error = !okType ? t.badType : file.size > MAX_BYTES && !file.type.startsWith('image/') ? t.tooBig : undefined;
      return { file, error, preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined };
    });
    setFiles((f) => [...f, ...added].slice(0, 10));
    setError('');
  }

  async function submit() {
    const good = files.filter((f) => !f.error);
    if (!good.length) return;
    setError('');
    setPhase('preparing');
    const form = new FormData();
    for (const f of good) {
      const blob = await compressImage(f.file);
      if (blob.size > MAX_BYTES) {
        setPhase('idle');
        setError(`${f.file.name}: ${t.tooBig}`);
        return;
      }
      const name = blob === f.file ? f.file.name : f.file.name.replace(/\.\w+$/, '') + '.jpg';
      form.append('files', blob, name);
    }
    if (note.trim()) form.append('note', note.trim());
    setPhase('uploading');
    setProgress(0);
    try {
      await uploadWithProgress(`${base}/files`, form, setProgress);
      setPhase('done');
      setFiles([]);
      setNote('');
      setInfo((i) => i && { ...i, uploadedCount: i.uploadedCount + good.length });
    } catch (e) {
      setPhase('idle');
      setError((e as Error).message || t.error);
    }
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <p className="mt-20 text-lg text-slate-700">{loadError}</p>
      </div>
    );
  }
  if (!info) return <div className="p-6 text-center text-slate-500">…</div>;

  const period = lang === 'ne' ? info.task.periodLabelNe || info.task.periodLabel : info.task.periodLabel;
  const busy = phase === 'preparing' || phase === 'uploading';

  return (
    <div className="mx-auto min-h-screen max-w-md bg-white px-4 pb-10">
      {DEMO && (
        <div className="-mx-4 bg-amber-100 px-4 py-2 text-xs text-amber-900">
          Demo: this is the page your client sees after tapping the SMS link.{' '}
          <Link to="/" className="font-semibold underline">Back to accountant dashboard</Link>
        </div>
      )}
      <header className="flex items-center justify-between border-b py-3">
        <div className="flex items-center gap-2">
          {info.firm.hasLogo && <img src={`${base}/logo`} alt="" className="h-9 w-9 rounded object-contain" />}
          <span className="font-semibold text-slate-800">{info.firm.name}</span>
        </div>
        <button className="rounded border px-2 py-1 text-sm" onClick={() => setLang(lang === 'ne' ? 'en' : 'ne')}>
          {lang === 'ne' ? 'English' : 'नेपाली'}
        </button>
      </header>

      <section className="mt-5">
        <p className="text-slate-600">
          {t.hello} {info.client.ownerName} ({info.client.businessName})
        </p>
        <p className="mt-2 text-slate-700">{t.requested}</p>
        <div className="mt-2 rounded-xl bg-brand-50 p-4">
          <div className="text-xl font-bold text-brand-700">{period}</div>
          <div className="text-sm text-slate-600">{info.task.ruleName[lang]}</div>
          <div className="mt-1 text-sm">
            {t.due}: <b>{formatBs(info.task.dueDateBs, lang)}</b>
          </div>
        </div>
        {info.uploadedCount > 0 && (
          <p className="mt-3 text-sm text-green-700">
            ✓ {t.already}: {lang === 'ne' ? toNepaliDigits(info.uploadedCount) : info.uploadedCount}
          </p>
        )}
      </section>

      {phase === 'done' && (
        <div className="mt-5 rounded-xl bg-green-50 p-4 text-center text-green-800">
          <div className="text-3xl">✓</div>
          <p className="mt-1 font-medium">{t.done}</p>
          <button className="mt-3 text-sm underline" onClick={() => setPhase('idle')}>
            {t.more}
          </button>
        </div>
      )}

      {phase !== 'done' && (
        <section className="mt-6 space-y-3">
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => (addFiles(e.target.files), (e.target.value = ''))} />
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,application/pdf" multiple className="hidden" onChange={(e) => (addFiles(e.target.files), (e.target.value = ''))} />
          <button disabled={busy} onClick={() => cameraRef.current?.click()} className="w-full rounded-2xl bg-brand-500 py-5 text-lg font-semibold text-white active:bg-brand-700">
            📷 {t.takePhoto}
          </button>
          <button disabled={busy} onClick={() => fileRef.current?.click()} className="w-full rounded-2xl border-2 border-brand-500 py-4 text-lg font-semibold text-brand-700">
            📄 {t.chooseFile}
          </button>
          <p className="text-center text-xs text-slate-500">{t.hint}</p>

          {files.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium">
                {t.selected} ({files.length})
              </p>
              <ul className="grid grid-cols-3 gap-2">
                {files.map((f, i) => (
                  <li key={i} className="relative rounded-lg border p-1 text-center text-xs">
                    {f.preview ? <img src={f.preview} alt="" className="h-20 w-full rounded object-cover" /> : <div className="flex h-20 items-center justify-center text-2xl">📄</div>}
                    <div className="truncate">{f.file.name}</div>
                    {f.error && <div className="text-red-600">{f.error}</div>}
                    {!busy && (
                      <button aria-label={t.remove} className="absolute right-1 top-1 rounded-full bg-white/90 px-1.5 shadow" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                        ×
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <textarea className="mt-3 w-full rounded-lg border p-2 text-sm" rows={2} placeholder={t.note} value={note} onChange={(e) => setNote(e.target.value)} />
              <button disabled={busy || !files.some((f) => !f.error)} onClick={submit} className="mt-3 w-full rounded-2xl bg-slate-900 py-4 text-lg font-semibold text-white disabled:opacity-50">
                {phase === 'preparing' ? t.preparing : phase === 'uploading' ? `${t.uploading} ${Math.round(progress * 100)}%` : t.upload}
              </button>
              {phase === 'uploading' && (
                <div className="mt-2 h-2 overflow-hidden rounded bg-slate-200">
                  <div className="h-full bg-brand-500 transition-all" style={{ width: `${progress * 100}%` }} />
                </div>
              )}
            </div>
          )}
          {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        </section>
      )}

      {info.firm.phone && (
        <p className="mt-8 text-center text-sm text-slate-500">
          {t.questions}: <a href={`tel:${info.firm.phone}`} className="underline">{info.firm.phone}</a>
        </p>
      )}
    </div>
  );
}
