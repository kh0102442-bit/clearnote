/* ============================================================
   js/chat-media.js — الجزء 1/2
   يحتوي: الإعدادات، تصنيف الملفات والتحقق منها (كل الصيغ مقبولة)،
   الرفع إلى Cloudinary مع التقدم والإلغاء، بناء كائن المرفق،
   منتقي الملفات، ونافذة المعاينة قبل الإرسال.
   الجزء 2/2 يحتوي: إرسال المرفق، تسجيل الصوت، عرض المرفقات،
   الصور المكبّرة، مشغّل الصوت، والتصدير (ChatMedia).
   ============================================================ */

import { ChatCore } from './chat-core.js';

const { CHAT_LIMITS } = ChatCore.constants;

const MEDIA_CFG = Object.freeze({
  CLOUD_NAME: 'nopxs3zt',
  UPLOAD_PRESET: 'clearnote_unsigned',
  CLOUD_PREFIX: 'https://res.cloudinary.com/nopxs3zt/',
  API_BASE: 'https://api.cloudinary.com/v1_1/nopxs3zt',
  MAX_VIDEO: CHAT_LIMITS.ATTACH_MAX_VIDEO, // 100 MB
  MAX_OTHER: CHAT_LIMITS.ATTACH_MAX_OTHER, // 50 MB
  NAME_MAX: 255,
  CAPTION_MAX: CHAT_LIMITS.TEXT_MAX,
  VOICE_MAX_MS: 5 * 60 * 1000,
  VOICE_MIN_MS: 800,
  LEVEL_BARS: 28,
});

/** امتدادات تُستخدم عند غياب نوع MIME أو كونه عاماً (application/octet-stream). */
const EXT_KIND = Object.freeze({
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image',
  bmp: 'image', avif: 'image', heic: 'image', heif: 'image',
  mp4: 'video', m4v: 'video', mov: 'video', webm: 'video', mkv: 'video',
  avi: 'video', '3gp': 'video', ogv: 'video', mpeg: 'video', mpg: 'video',
  mp3: 'audio', wav: 'audio', ogg: 'audio', oga: 'audio', opus: 'audio',
  m4a: 'audio', aac: 'audio', flac: 'audio', amr: 'audio',
  pdf: 'pdf',
});

const KIND_TITLE = Object.freeze({
  image: 'إرسال صورة',
  video: 'إرسال فيديو',
  audio: 'إرسال صوت',
  pdf: 'إرسال ملف PDF',
  file: 'إرسال ملف',
});

let uidSeq = 0;

// ---------- أدوات صغيرة ----------

/** إنشاء عنصر DOM بخصائص وأبناء، دون innerHTML. */
function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [key, val] of Object.entries(attrs)) {
    if (val == null || val === false) continue;
    if (key === 'class') node.className = String(val);
    else if (key === 'text') node.textContent = String(val);
    else if (key === 'value') node.value = String(val);
    else if (key.startsWith('on') && typeof val === 'function') node.addEventListener(key.slice(2), val);
    else node.setAttribute(key, val === true ? '' : String(val));
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

function fmtBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} بايت`;
  const units = ['ك.ب', 'م.ب', 'ج.ب'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function extOf(name) {
  const s = String(name || '');
  const dot = s.lastIndexOf('.');
  return dot > -1 && dot < s.length - 1 ? s.slice(dot + 1).toLowerCase() : '';
}

function extLabel(name) {
  const ext = extOf(name).toUpperCase();
  return ext && ext.length <= 5 ? ext : 'FILE';
}

/** تنظيف اسم الملف من المحارف الخطرة وتقصيره. */
function safeName(name) {
  const cleaned = String(name || '')
    .replace(/[\u0000-\u001F\u007F\\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MEDIA_CFG.NAME_MAX);
  return cleaned || 'ملف';
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function abortError() {
  const err = new Error('أُلغي الإجراء');
  err.name = 'AbortError';
  return err;
}

function isAbortError(err) {
  return err?.name === 'AbortError';
}

function isCoarsePointer() {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
}

// ---------- تصنيف الملفات والتحقق منها ----------

/**
 * يحدد نوع المرفق ومورد Cloudinary المناسب ووحدة الحد الأقصى.
 * الصور تُرفع كـ image، والفيديو والصوت كـ video (هكذا يعالجهما Cloudinary)،
 * وكل ما عدا ذلك كـ raw ليُقبل أي امتداد دون قيود.
 */
function classify(file) {
  const mime = String(file.type || '').toLowerCase();
  let kind = null;

  if (mime.startsWith('image/') && mime !== 'image/svg+xml') kind = 'image';
  else if (mime.startsWith('video/')) kind = 'video';
  else if (mime.startsWith('audio/')) kind = 'audio';
  else if (mime === 'application/pdf') kind = 'pdf';

  if (!kind) kind = EXT_KIND[extOf(file.name)] || 'file';

  const resourceType = kind === 'image' ? 'image' : (kind === 'video' || kind === 'audio') ? 'video' : 'raw';
  const max = kind === 'video' ? MEDIA_CFG.MAX_VIDEO : MEDIA_CFG.MAX_OTHER;
  return { kind, resourceType, max };
}

/** يتحقق من الملف ويعيد معلوماته، أو يرمي خطأ بنص عربي جاهز للعرض. */
function inspectFile(file) {
  if (!file) throw new Error('لم يُختر أي ملف');
  if (file.size === 0) throw new Error('الملف فارغ ولا يمكن إرساله');
  const info = classify(file);
  if (file.size > info.max) {
    throw new Error(`حجم هذا الملف يتجاوز الحد المسموح (${fmtBytes(info.max)})`);
  }
  return info;
}

// ---------- الرفع إلى Cloudinary ----------

function cloudErrorText(status, body) {
  const detail = String(body?.error?.message || '');
  console.warn('[ChatMedia] Cloudinary error', status, detail);
  if (status === 413 || /file size|too large/i.test(detail)) return 'حجم الملف أكبر من المسموح به';
  if (/invalid.*preset|preset.*not found/i.test(detail)) return 'إعداد الرفع غير صحيح، يُرجى إبلاغ الإدارة';
  if (/format|extension/i.test(detail)) return 'نوع الملف غير مدعوم من خدمة الرفع';
  if (status === 401 || status === 403) return 'الرفع غير مسموح حالياً';
  return 'فشل رفع الملف، حاول مرة أخرى';
}

/**
 * رفع ملف (أو Blob) إلى Cloudinary عبر XHR لتتبع التقدم.
 * - onProgress(percent) يُستدعى أثناء الرفع.
 * - signal يلغي الرفع فيرفض الوعد بخطأ AbortError.
 */
function uploadToCloudinary(file, { resourceType, name, onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    const form = new FormData();
    form.append('file', file, safeName(name || file.name));
    form.append('upload_preset', MEDIA_CFG.UPLOAD_PRESET);
  

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${MEDIA_CFG.API_BASE}/${resourceType}/upload`, true);

    const onAbort = () => xhr.abort();
    const detach = () => signal?.removeEventListener('abort', onAbort);
    signal?.addEventListener('abort', onAbort, { once: true });

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && typeof onProgress === 'function') {
        onProgress((e.loaded / e.total) * 100);
      }
    };

    xhr.onload = () => {
      detach();
      const body = parseJson(xhr.responseText);
      const ok = xhr.status >= 200 && xhr.status < 300;
      if (!ok || !body?.secure_url) {
        reject(new Error(cloudErrorText(xhr.status, body)));
        return;
      }
      if (!String(body.secure_url).startsWith(MEDIA_CFG.CLOUD_PREFIX)) {
        reject(new Error('رابط الملف المرفوع غير متوقع'));
        return;
      }
      resolve(body);
    };

    xhr.onerror = () => {
      detach();
      reject(new Error('تعذّر الاتصال أثناء الرفع، تحقق من الشبكة'));
    };

    xhr.onabort = () => {
      detach();
      reject(abortError());
    };

    xhr.send(form);
  });
}

/**
 * بناء كائن المرفق بالحقول المتفق عليها مع القواعد:
 * url, name, size, kind, mime, publicId, duration, width, height.
 */
function buildAttachment({ file, meta, info, name, fallbackDuration }) {
  const positive = (v) => (Number.isFinite(v) && v > 0 ? v : null);

  const att = {
    url: meta.secure_url,
    name: safeName(name || file.name),
    size: file.size,
    kind: info.kind,
    mime: String(file.type || 'application/octet-stream').slice(0, 120),
    publicId: String(meta.public_id || '').slice(0, 300),
  };

  const duration = positive(meta.duration) ?? positive(fallbackDuration);
  const width = positive(meta.width);
  const height = positive(meta.height);
  if (duration != null) att.duration = duration;
  if (width != null) att.width = width;
  if (height != null) att.height = height;

  return att;
}

// ---------- منتقي الملفات ----------

/**
 * يفتح منتقي الملفات بلا قيود على الامتداد. يجب استدعاؤه مباشرة
 * من حدث نقر المستخدم، وإلا يمنعه المتصفح.
 */
function pickFileFromDevice() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.hidden = true;
    input.multiple = false;

    let settled = false;
    const done = (file) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file || null);
    };

    input.addEventListener('change', () => done(input.files?.[0] || null));
    input.addEventListener('cancel', () => done(null));

    document.body.append(input);
    input.click();
  });
}

// ---------- نافذة المعاينة قبل الإرسال ----------

function previewNode(file, info, url) {
  if (url && info.kind === 'image') {
    return el('img', { class: 'cs-media-preview-img', src: url, alt: '', decoding: 'async' });
  }
  if (url && info.kind === 'video') {
    return el('video', {
      class: 'cs-media-preview-video',
      src: url,
      controls: true,
      muted: true,
      playsinline: true,
      preload: 'metadata',
    });
  }
  if (url && info.kind === 'audio') {
    return el('audio', { class: 'cs-media-preview-audio', src: url, controls: true, preload: 'metadata' });
  }
  return el(
    'div',
    { class: 'cs-media-file' },
    el('span', { class: 'cs-media-file-ext', text: extLabel(file.name) }),
    el(
      'span',
      { class: 'cs-media-file-meta' },
      el('strong', { text: safeName(file.name) }),
      el('small', { text: fmtBytes(file.size) }),
    ),
  );
}

/**
 * نافذة الإرسال: معاينة، وتعديل الاسم والتعليق، ثم رفع وإرسال.
 * upload(ctx) تُنفَّذ بعد التأكيد، وctx = { name, caption, signal, progress(pct), status(text) }.
 * - تُرجع Promise<true> عند الإرسال الناجح، وPromise<false> عند الإلغاء.
 * - إن رمت upload خطأً غير الإلغاء تبقى النافذة مفتوحة وتعرض الرسالة.
 */
function runSendDialog({ file, info, text = '', title, upload }) {
  return new Promise((resolve) => {
    const previewable = info.kind === 'image' || info.kind === 'video' || info.kind === 'audio';
    const previewUrl = previewable ? URL.createObjectURL(file) : null;
    const titleId = `cs-media-title-${++uidSeq}`;

    const nameInput = el('input', {
      class: 'cs-media-name',
      type: 'text',
      maxlength: MEDIA_CFG.NAME_MAX,
      autocomplete: 'off',
      'aria-label': 'اسم الملف',
    });
    nameInput.value = safeName(file.name);

    const captionInput = el('textarea', {
      class: 'cs-media-caption',
      rows: 2,
      maxlength: MEDIA_CFG.CAPTION_MAX,
      placeholder: 'أضف تعليقاً (اختياري)',
      'aria-label': 'تعليق',
    });
    captionInput.value = String(text || '').slice(0, MEDIA_CFG.CAPTION_MAX);

    const closeBtn = el('button', { type: 'button', class: 'cs-media-close', 'aria-label': 'إغلاق', text: '✕' });
    const head = el(
      'div',
      { class: 'cs-media-head' },
      el('h3', { class: 'cs-media-title', id: titleId, text: title || KIND_TITLE[info.kind] || KIND_TITLE.file }),
      closeBtn,
    );

    const body = el(
      'div',
      { class: 'cs-media-body' },
      el('div', { class: 'cs-media-preview' }, previewNode(file, info, previewUrl)),
      el('label', { class: 'cs-media-field' }, el('span', { text: 'اسم الملف' }), nameInput),
      el('label', { class: 'cs-media-field' }, el('span', { text: 'تعليق' }), captionInput),
    );

    const barFill = el('div', { class: 'cs-media-bar-fill' });
    const status = el('p', { class: 'cs-media-status', role: 'status' });
    const progress = el(
      'div',
      { class: 'cs-media-progress', hidden: true },
      el('div', { class: 'cs-media-bar' }, barFill),
      status,
    );
    const errorLine = el('p', { class: 'cs-media-error', role: 'alert', hidden: true });

    const cancelBtn = el('button', { type: 'button', class: 'cs-media-btn ghost', text: 'إلغاء' });
    const sendBtn = el('button', { type: 'button', class: 'cs-media-btn primary', text: 'إرسال' });
    const foot = el('div', { class: 'cs-media-foot' }, cancelBtn, sendBtn);

    const dialog = el(
      'div',
      { class: 'cs-media-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      head,
      body,
      progress,
      errorLine,
      foot,
    );
    const overlay = el('div', { class: 'cs-media-overlay' }, dialog);

    let busy = false;
    let finished = false;
    let controller = null;

    const setStatus = (text) => { status.textContent = String(text || ''); };

    const setProgress = (pct) => {
      const v = Math.max(0, Math.min(100, Math.round(pct)));
      barFill.style.width = `${v}%`;
      setStatus(`جارٍ الرفع… ${v}%`);
    };

    const showError = (msg) => {
      errorLine.textContent = msg;
      errorLine.hidden = false;
    };

    const setBusy = (on) => {
      busy = on;
      progress.hidden = !on;
      errorLine.hidden = true;
      nameInput.disabled = on;
      captionInput.disabled = on;
      sendBtn.disabled = on;
      cancelBtn.textContent = on ? 'إلغاء الرفع' : 'إلغاء';
      if (on) {
        barFill.style.width = '0%';
        setStatus('جارٍ التحضير…');
      }
    };

    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      cancel();
    };

    const finish = (sent) => {
      if (finished) return;
      finished = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.querySelectorAll('video, audio').forEach((m) => m.pause());
      overlay.classList.remove('is-open');
      setTimeout(() => {
        overlay.remove();
        if (previewUrl) URL.revokeObjectURL(previewUrl);
      }, 180);
      resolve(sent);
    };

    const cancel = () => {
      if (finished) return;
      if (busy) {
        controller?.abort();
        return;
      }
      finish(false);
    };

    const submit = async () => {
      if (busy || finished) return;
      const name = safeName(nameInput.value || file.name);
      const caption = captionInput.value.trim().slice(0, MEDIA_CFG.CAPTION_MAX);

      controller = new AbortController();
      setBusy(true);
      try {
        const sent = await upload({
          name,
          caption,
          signal: controller.signal,
          progress: setProgress,
          status: setStatus,
        });
        if (sent) {
          finish(true);
          return;
        }
        setBusy(false);
        showError('تعذّر إرسال الملف، حاول مرة أخرى');
      } catch (err) {
        if (isAbortError(err)) {
          finish(false);
          return;
        }
        console.error('[ChatMedia]', err);
        setBusy(false);
        showError(err?.message || 'تعذّر إرسال الملف');
      } finally {
        controller = null;
      }
    };

    closeBtn.addEventListener('click', cancel);
    cancelBtn.addEventListener('click', cancel);
    sendBtn.addEventListener('click', submit);
    captionInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submit();
      }
    });
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    });
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay && !busy) cancel();
    });

    document.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    requestAnimationFrame(() => overlay.classList.add('is-open'));
    if (!isCoarsePointer()) captionInput.focus();
  });
}
/* ============================================================
   js/chat-media.js — الجزء 2/2
   يحتوي: إرسال المرفق بعد المعاينة، منتقي الملفات، تسجيل الصوت،
   عرض المرفقات (صور، فيديو، صوت بمشغّل مخصص، ملفات)،
   المعاينة المكبّرة للصور، التنبيهات، والتصدير (ChatMedia)
   ============================================================ */

const VOICE_MIME_CANDIDATES = Object.freeze([
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
]);

const PLAYBACK_RATES = Object.freeze([1, 1.5, 2]);

let voiceActive = false;
let currentAudio = null;
let lightboxEl = null;

// ---------- أدوات مساعدة (الجزء 2/2) ----------

function isPositive(v) {
  return Number.isFinite(v) && v > 0;
}

function fmtClock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function isSafeCloudUrl(url) {
  return typeof url === 'string' && url.length <= 500 && url.startsWith(MEDIA_CFG.CLOUD_PREFIX);
}

function applyRatio(node, att) {
  if (isPositive(att.width) && isPositive(att.height)) {
    node.style.aspectRatio = `${att.width} / ${att.height}`;
  }
}

function baseMime(type) {
  return String(type || '').split(';')[0].trim().toLowerCase() || 'audio/webm';
}

function voiceExt(mime) {
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('wav')) return 'wav';
  return 'webm';
}

function voiceFileName(mime) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `voice-${stamp}.${voiceExt(mime)}`;
}

// ---------- التنبيهات ----------

function mediaToastHost() {
  let host = document.querySelector('.cs-media-flash-host');
  if (!host) {
    host = el('div', { class: 'cs-media-flash-host', 'aria-live': 'polite' });
    document.body.append(host);
  }
  return host;
}

/** تنبيه خفيف مستقل عن تنبيهات الواجهة، لأخطاء الوسائط. */
function notifyMedia(text, tone = 'info') {
  const host = mediaToastHost();
  while (host.childElementCount >= 3) host.firstElementChild.remove();

  const node = el('div', { class: `cs-media-flash is-${tone}`, role: 'status', text });
  host.append(node);
  requestAnimationFrame(() => node.classList.add('is-in'));
  setTimeout(() => {
    node.classList.remove('is-in');
    setTimeout(() => node.remove(), 220);
  }, 3200);
}

// ---------- إرسال المرفق ----------

/**
 * يعرض نافذة المعاينة، ثم يرفع الملف إلى Cloudinary ويرسله عبر ChatCore.
 * يُرجع Promise<boolean>: true فقط إذا أُرسلت الرسالة فعلاً.
 *
 * ملاحظة: يفترض التوقيع ChatCore.sendAttachment(chatId, attachment, { text, replyTo }).
 * إن اختلف في chat-core.js يُعدَّل هذا الموضع وموضع التسجيل الصوتي فقط.
 */
function sendAttachmentFile({ chatId, file, info, text = '', replyTo = null, title }) {
  return runSendDialog({
    file,
    info,
    text,
    title,
    upload: async (ctx) => {
      const meta = await uploadToCloudinary(file, {
        resourceType: info.resourceType,
        name: ctx.name,
        onProgress: ctx.progress,
        signal: ctx.signal,
      });

      // إن أُلغي الإجراء بعد اكتمال الرفع، لا تُرسل الرسالة.
      if (ctx.signal.aborted) throw abortError();

      ctx.status('جارٍ إرسال الرسالة…');
      const att = buildAttachment({ file, meta, info, name: ctx.name });
      const sent = await ChatCore.sendAttachment(chatId, att, { text: ctx.caption, replyTo });
      return sent !== false;
    },
  });
}

// ---------- منتقي الملفات ----------

/**
 * يفتح منتقي الملفات ثم نافذة المعاينة.
 * يجب استدعاؤه مباشرة من نقرة المستخدم، دون أي await قبله.
 * يُرجع Promise<boolean>: true فقط عند إرسال رسالة فعلاً.
 */
async function pick(chatId, opts = {}) {
  const file = await pickFileFromDevice();
  if (!file) return false;

  if (!chatId) {
    notifyMedia('افتح محادثة أولاً', 'info');
    return false;
  }

  let info;
  try {
    info = inspectFile(file);
  } catch (err) {
    notifyMedia(err.message, 'danger');
    return false;
  }

  return sendAttachmentFile({
    chatId,
    file,
    info,
    text: typeof opts.text === 'string' ? opts.text : '',
    replyTo: opts.replyTo ?? null,
  });
}

// ---------- تسجيل الصوت ----------

function canRecordVoice() {
  return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

function micErrorText(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'لم يُسمح للموقع باستخدام الميكروفون';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'لا يوجد ميكروفون متصل بالجهاز';
    case 'NotReadableError':
      return 'الميكروفون مستخدم من تطبيق آخر';
    default:
      return 'تعذّر بدء التسجيل الصوتي';
  }
}

function pickRecorderMime() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }
  return VOICE_MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

/** يرسم مستوى الصوت على الأعمدة من بيانات الموجة الزمنية. */
function drawLevels(buf, bars) {
  const step = Math.max(1, Math.floor(buf.length / bars.length));
  for (let i = 0; i < bars.length; i += 1) {
    let peak = 0;
    const from = i * step;
    const to = Math.min(buf.length, from + step);
    for (let j = from; j < to; j += 1) {
      const v = Math.abs(buf[j] - 128) / 128;
      if (v > peak) peak = v;
    }
    const scale = Math.max(0.12, Math.min(1, peak * 2.5));
    bars[i].style.transform = `scaleY(${scale.toFixed(3)})`;
  }
}

/** مراقب مستوى الصوت. يُرجع null إن لم يتوفر AudioContext. */
function startMeter(stream, bars) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;

  let ctx;
  try {
    ctx = new Ctx();
  } catch {
    return null;
  }
  ctx.resume?.().catch(() => {});

  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);

  const buf = new Uint8Array(analyser.fftSize);
  let running = true;
  let raf = 0;

  const frame = () => {
    if (!running) return;
    analyser.getByteTimeDomainData(buf);
    drawLevels(buf, bars);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      try { source.disconnect(); } catch { /* لا شيء */ }
      ctx.close().catch(() => {});
    },
  };
}

function buildVoiceUi() {
  const bars = Array.from({ length: MEDIA_CFG.LEVEL_BARS }, () => el('span', { class: 'cs-voice-bar' }));
  const timeEl = el('span', { class: 'cs-voice-time', 'aria-live': 'off', text: '0:00' });
  const dot = el('span', { class: 'cs-voice-dot', 'aria-hidden': 'true' });

  const recordWrap = el(
    'div',
    { class: 'cs-voice-record' },
    el('div', { class: 'cs-voice-meta' }, dot, timeEl),
    el('div', { class: 'cs-voice-wave', 'aria-hidden': 'true' }, bars),
  );

  const barFill = el('div', { class: 'cs-media-bar-fill' });
  const statusEl = el('p', { class: 'cs-media-status', role: 'status' });
  const uploadWrap = el(
    'div',
    { class: 'cs-media-progress', hidden: true },
    el('div', { class: 'cs-media-bar' }, barFill),
    statusEl,
  );

  const errorEl = el('p', { class: 'cs-media-error', role: 'alert', hidden: true });
  const discardBtn = el('button', { type: 'button', class: 'cs-media-btn ghost', text: 'إلغاء' });
  const sendBtn = el('button', { type: 'button', class: 'cs-media-btn primary', text: 'إرسال' });

  const dialog = el(
    'div',
    { class: 'cs-media-dialog cs-voice-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'رسالة صوتية' },
    el('h3', { class: 'cs-media-title', text: 'رسالة صوتية' }),
    recordWrap,
    uploadWrap,
    errorEl,
    el('div', { class: 'cs-media-foot' }, discardBtn, sendBtn),
  );
  const overlay = el('div', { class: 'cs-media-overlay' }, dialog);

  return {
    overlay,
    bars,
    discardBtn,
    sendBtn,
    setTime(ms) {
      timeEl.textContent = fmtClock(ms / 1000);
    },
    setProgress(pct) {
      const v = Math.max(0, Math.min(100, Math.round(pct)));
      barFill.style.width = `${v}%`;
      statusEl.textContent = `جارٍ الرفع… ${v}%`;
    },
    setStatus(text) {
      statusEl.textContent = String(text || '');
    },
    showUpload() {
      recordWrap.hidden = true;
      uploadWrap.hidden = false;
      sendBtn.disabled = true;
      discardBtn.textContent = 'إلغاء الرفع';
      barFill.style.width = '0%';
      statusEl.textContent = 'جارٍ التحضير…';
    },
    showError(text) {
      uploadWrap.hidden = true;
      errorEl.textContent = text;
      errorEl.hidden = false;
      sendBtn.hidden = true;
      discardBtn.textContent = 'إغلاق';
      discardBtn.disabled = false;
    },
  };
}

/**
 * جلسة التسجيل الكاملة: تسجيل، ثم إلغاء أو إرسال، ثم رفع وإرسال.
 * الحد الأقصى يوقف التسجيل تلقائياً ويرسله.
 */
async function runVoiceSession({ stream, chatId, replyTo }) {
  const ui = buildVoiceUi();
  const mime = pickRecorderMime();
  const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);

  const chunks = [];
  recorder.addEventListener('dataavailable', (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  });
  const recorderStopped = new Promise((resolve) => {
    recorder.addEventListener('stop', resolve, { once: true });
  });

  let phase = 'record'; // record | upload | error
  let uploadController = null;

  let decide = () => {};
  const decision = new Promise((resolve) => { decide = resolve; });

  let closeNow = () => {};
  const closed = new Promise((resolve) => { closeNow = resolve; });

  const handleDiscard = () => {
    if (phase === 'record') decide('cancel');
    else if (phase === 'upload') uploadController?.abort();
    else if (phase === 'error') closeNow();
  };

  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    handleDiscard();
  };

  ui.discardBtn.addEventListener('click', handleDiscard);
  ui.sendBtn.addEventListener('click', () => {
    if (phase === 'record') decide('send');
  });
  document.addEventListener('keydown', onKey, true);
  document.body.append(ui.overlay);
  requestAnimationFrame(() => ui.overlay.classList.add('is-open'));

  const meter = startMeter(stream, ui.bars);
  const startedAt = performance.now();
  const ticker = setInterval(() => {
    const elapsed = performance.now() - startedAt;
    ui.setTime(elapsed);
    if (elapsed >= MEDIA_CFG.VOICE_MAX_MS) decide('send');
  }, 200);

  recorder.start(1000);

  const finishOverlay = () => {
    document.removeEventListener('keydown', onKey, true);
    ui.overlay.classList.remove('is-open');
    setTimeout(() => ui.overlay.remove(), 180);
  };

  const action = await decision;
  clearInterval(ticker);
  const duration = performance.now() - startedAt;
  meter?.stop();
  if (recorder.state !== 'inactive') recorder.stop();
  await recorderStopped;

  if (action !== 'send') {
    finishOverlay();
    return false;
  }

  if (duration < MEDIA_CFG.VOICE_MIN_MS) {
    finishOverlay();
    notifyMedia('الرسالة الصوتية قصيرة جداً', 'info');
    return false;
  }

  const type = baseMime(recorder.mimeType || mime);
  const blob = new Blob(chunks, { type });
  if (blob.size === 0) {
    finishOverlay();
    notifyMedia('تعذّر حفظ التسجيل، حاول مرة أخرى', 'danger');
    return false;
  }

  const file = new File([blob], voiceFileName(type), { type });
  const info = { kind: 'audio', resourceType: 'video', max: MEDIA_CFG.MAX_OTHER };
  if (file.size > info.max) {
    finishOverlay();
    notifyMedia(`حجم التسجيل يتجاوز الحد المسموح (${fmtBytes(info.max)})`, 'danger');
    return false;
  }

  phase = 'upload';
  ui.showUpload();
  uploadController = new AbortController();

  try {
    const meta = await uploadToCloudinary(file, {
      resourceType: 'video',
      name: file.name,
      onProgress: ui.setProgress,
      signal: uploadController.signal,
    });

    if (uploadController.signal.aborted) throw abortError();

    ui.setStatus('جارٍ إرسال الرسالة…');
    const att = buildAttachment({
      file,
      meta,
      info,
      name: file.name,
      fallbackDuration: duration / 1000,
    });
    const sent = await ChatCore.sendAttachment(chatId, att, { replyTo });
    finishOverlay();
    return sent !== false;
  } catch (err) {
    if (isAbortError(err)) {
      finishOverlay();
      return false;
    }
    console.error('[ChatMedia] voice upload', err);
    phase = 'error';
    ui.showError(err?.message || 'تعذّر إرسال الرسالة الصوتية');
    await closed;
    finishOverlay();
    return false;
  } finally {
    uploadController = null;
  }
}

/**
 * تسجيل رسالة صوتية وإرسالها.
 * يُرجع Promise<boolean>: true فقط عند إرسال الرسالة فعلاً.
 */
async function recordVoice(chatId, opts = {}) {
  if (voiceActive) return false;
  if (!chatId) {
    notifyMedia('افتح محادثة أولاً', 'info');
    return false;
  }
  if (!canRecordVoice()) {
    notifyMedia('التسجيل الصوتي غير مدعوم في هذا المتصفح', 'danger');
    return false;
  }

  voiceActive = true;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    voiceActive = false;
    console.warn('[ChatMedia] microphone', err);
    notifyMedia(micErrorText(err), 'danger');
    return false;
  }

  try {
    return await runVoiceSession({ stream, chatId, replyTo: opts.replyTo ?? null });
  } catch (err) {
    console.error('[ChatMedia] recordVoice', err);
    notifyMedia('تعذّر تشغيل التسجيل الصوتي', 'danger');
    return false;
  } finally {
    voiceActive = false;
    stream.getTracks().forEach((track) => track.stop());
  }
}

// ---------- عرض المرفقات ----------

/** يبني عنصر المرفق داخل الفقاعة حسب نوعه. */
function renderAttachment(att, _msg) {
  if (!att || typeof att !== 'object' || !isSafeCloudUrl(att.url)) {
    return el(
      'div',
      { class: 'cs-file-card is-broken', role: 'note' },
      el('span', { class: 'cs-file-card-meta', text: 'مرفق غير متاح' }),
    );
  }

  switch (att.kind) {
    case 'image': return imageNode(att);
    case 'video': return videoNode(att);
    case 'audio': return audioNode(att);
    default: return fileCardNode(att);
  }
}

function imageNode(att) {
  const name = safeName(att.name);
  const img = el('img', {
    class: 'cs-media-img',
    src: att.url,
    alt: name,
    loading: 'lazy',
    decoding: 'async',
  });
  applyRatio(img, att);

  return el(
    'button',
    {
      type: 'button',
      class: 'cs-media-img-btn',
      'aria-label': `تكبير الصورة ${name}`,
      onclick: () => openLightbox(att),
    },
    img,
  );
}

function videoNode(att) {
  const video = el('video', {
    class: 'cs-media-video',
    src: att.url,
    controls: true,
    playsinline: true,
    preload: 'metadata',
  });
  applyRatio(video, att);
  return video;
}

/** مشغّل صوت مخصص للرسائل الصوتية والملفات الصوتية. */
function audioNode(att) {
  const audio = el('audio', { preload: 'metadata', src: att.url, hidden: true });
  const playBtn = el('button', { type: 'button', class: 'cs-audio-play', 'aria-label': 'تشغيل', text: '▶' });
  const seek = el('input', {
    type: 'range',
    class: 'cs-audio-seek',
    min: '0',
    max: '1000',
    step: '1',
    value: '0',
    'aria-label': 'موضع التشغيل',
  });
  const timeEl = el('span', { class: 'cs-audio-time', text: '0:00' });
  const rateBtn = el('button', { type: 'button', class: 'cs-audio-rate', 'aria-label': 'سرعة التشغيل', text: '1x' });

  const knownDuration = isPositive(att.duration) ? att.duration : 0;
  let rateIdx = 0;

  const duration = () => (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : knownDuration);

  const render = () => {
    const total = duration();
    const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    timeEl.textContent = `${fmtClock(current)} / ${fmtClock(total)}`;
    if (total > 0) seek.value = String(Math.round((Math.min(current, total) / total) * 1000));
  };

  audio.addEventListener('loadedmetadata', () => {
    audio.playbackRate = PLAYBACK_RATES[rateIdx];
    if (audio.duration === Infinity) {
      // بعض تسجيلات MediaRecorder لا تحمل مدة؛ نقفز للنهاية لكشفها ثم نعود للبداية.
      audio.currentTime = 1e101;
      audio.addEventListener('timeupdate', function unlockDuration() {
        audio.removeEventListener('timeupdate', unlockDuration);
        audio.currentTime = 0;
        render();
      });
    }
    render();
  });
  audio.addEventListener('durationchange', render);
  audio.addEventListener('timeupdate', render);

  audio.addEventListener('play', () => {
    if (currentAudio && currentAudio !== audio) currentAudio.pause();
    currentAudio = audio;
    playBtn.textContent = '❚❚';
    playBtn.setAttribute('aria-label', 'إيقاف مؤقت');
  });
  audio.addEventListener('pause', () => {
    playBtn.textContent = '▶';
    playBtn.setAttribute('aria-label', 'تشغيل');
  });
  audio.addEventListener('ended', () => {
    audio.currentTime = 0;
    render();
  });
  audio.addEventListener('error', () => {
    playBtn.disabled = true;
    timeEl.textContent = 'تعذّر تحميل الصوت';
  });

  playBtn.addEventListener('click', () => {
    if (audio.paused) {
      audio.play().catch(() => notifyMedia('تعذّر تشغيل الرسالة الصوتية', 'danger'));
    } else {
      audio.pause();
    }
  });

  seek.addEventListener('input', () => {
    const total = duration();
    if (total > 0) audio.currentTime = (Number(seek.value) / 1000) * total;
    render();
  });

  rateBtn.addEventListener('click', () => {
    rateIdx = (rateIdx + 1) % PLAYBACK_RATES.length;
    audio.playbackRate = PLAYBACK_RATES[rateIdx];
    rateBtn.textContent = `${PLAYBACK_RATES[rateIdx]}x`;
  });

  timeEl.textContent = `0:00 / ${fmtClock(knownDuration)}`;

  return el('div', { class: 'cs-audio' }, audio, playBtn, seek, timeEl, rateBtn);
}

function fileCardNode(att) {
  const name = safeName(att.name);
  return el(
    'a',
    {
      class: 'cs-file-card',
      href: att.url,
      target: '_blank',
      rel: 'noopener noreferrer',
      download: name,
      'aria-label': `فتح أو تنزيل ${name}`,
    },
    el('span', { class: 'cs-file-card-ext', text: extLabel(name) }),
    el(
      'span',
      { class: 'cs-file-card-meta' },
      el('strong', { text: name }),
      el('small', { text: fmtBytes(att.size) || 'ملف' }),
    ),
    el('span', { class: 'cs-file-card-dl', 'aria-hidden': 'true', text: '⭳' }),
  );
}

// ---------- المعاينة المكبّرة للصور ----------

function closeLightbox() {
  if (!lightboxEl) return;
  document.removeEventListener('keydown', lightboxEl.onKey, true);
  lightboxEl.root.remove();
  document.body.style.overflow = lightboxEl.prevOverflow;
  lightboxEl = null;
}

function openLightbox(att) {
  if (!att || !isSafeCloudUrl(att.url)) return;
  closeLightbox();

  const name = safeName(att.name);
  const img = el('img', { class: 'cs-lightbox-img', src: att.url, alt: name, draggable: 'false' });
  const zoomBtn = el('button', { type: 'button', class: 'cs-lightbox-btn', 'aria-label': 'تكبير', text: '+' });
  const dlBtn = el('a', {
    class: 'cs-lightbox-btn',
    href: att.url,
    target: '_blank',
    rel: 'noopener noreferrer',
    download: name,
    'aria-label': 'تنزيل الصورة',
    text: '⭳',
  });
  const closeBtn = el('button', { type: 'button', class: 'cs-lightbox-btn', 'aria-label': 'إغلاق', text: '✕' });
  const stage = el('div', { class: 'cs-lightbox-stage' }, img);
  const root = el(
    'div',
    { class: 'cs-lightbox', role: 'dialog', 'aria-modal': 'true', 'aria-label': name },
    el('div', { class: 'cs-lightbox-bar' }, zoomBtn, dlBtn, closeBtn),
    stage,
  );

  zoomBtn.addEventListener('click', () => {
    const on = root.classList.toggle('is-zoomed');
    zoomBtn.textContent = on ? '−' : '+';
    zoomBtn.setAttribute('aria-label', on ? 'تصغير' : 'تكبير');
  });
  closeBtn.addEventListener('click', closeLightbox);
  stage.addEventListener('click', (e) => {
    if (e.target === stage) closeLightbox();
  });

  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    closeLightbox();
  };
  document.addEventListener('keydown', onKey, true);

  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  document.body.append(root);
  lightboxEl = { root, onKey, prevOverflow };

  requestAnimationFrame(() => root.classList.add('is-open'));
  closeBtn.focus();
}

// ---------- التصدير ----------

export const ChatMedia = Object.freeze({
  pick,
  recordVoice,
  renderAttachment,
  openLightbox,
  closeLightbox,
  limits: Object.freeze({
    maxVideo: MEDIA_CFG.MAX_VIDEO,
    maxOther: MEDIA_CFG.MAX_OTHER,
  }),
});
