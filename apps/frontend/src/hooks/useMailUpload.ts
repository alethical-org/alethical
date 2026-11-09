import { useEffect, useRef, useState } from 'react';
import {
  createMailSubmission,
  getMailSubmission,
  getMailUploadSession,
  uploadMailImage,
  submitMailSubmission,
  MailUploadError,
  MAX_MAIL_IMAGE_BYTES,
  type MailImageReceipt,
  type MailImageSide,
  type MailUploadSession,
} from '../data/mailUpload';

export type PhotoState = {
  file?: File;
  confirmedFile?: File;
  receipt?: MailImageReceipt;
  busy: boolean;
  error?: string;
};
const emptyPhotos = (): Record<MailImageSide, PhotoState> => ({
  front: { busy: false },
  back: { busy: false },
});

/** Private form state stays in memory; retries keep the original submission identity. */
export function useMailUpload() {
  const [access, setAccess] = useState<'loading' | 'ready' | 'missing' | 'expired' | 'failed'>(
    'loading',
  );
  const [photos, setPhotos] = useState(emptyPhotos);
  const photoRef = useRef(photos);
  const [likes, setLikes] = useState<boolean | null>(null);
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState<Partial<Record<MailImageSide | 'likes', string>>>({});
  const [status, setStatus] = useState<'editing' | 'sending' | 'retry' | 'saved'>('editing');
  const statusRef = useRef(status);
  const [failure, setFailure] = useState('');
  const session = useRef<MailUploadSession | null>(null);
  const id = useRef<string | null>(null);
  const draft = useRef<Promise<void> | null>(null);
  const payload = useRef<{ likes_ad: boolean; comment: string } | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  const requests = useRef(new AbortController());
  const updateStatus = (value: typeof status) => {
    statusRef.current = value;
    if (mounted.current) setStatus(value);
  };
  const updatePhoto = (side: MailImageSide, change: Partial<PhotoState>) => {
    photoRef.current = { ...photoRef.current, [side]: { ...photoRef.current[side], ...change } };
    if (mounted.current) setPhotos(photoRef.current);
  };
  const checkAccess = async () => {
    const current = ++generation.current;
    requests.current.abort();
    requests.current = new AbortController();
    session.current = null;
    id.current = null;
    draft.current = null;
    payload.current = null;
    photoRef.current = emptyPhotos();
    setPhotos(photoRef.current);
    setLikes(null);
    setComment('');
    setErrors({});
    setFailure('');
    updateStatus('editing');
    setAccess('loading');
    try {
      const result = await getMailUploadSession();
      if (!mounted.current || generation.current !== current) return;
      session.current = result;
      setAccess('ready');
    } catch (error) {
      if (mounted.current && generation.current === current)
        setAccess(
          error instanceof MailUploadError && error.status === 401
            ? error.detail === 'Open your invitation link to continue'
              ? 'missing'
              : 'expired'
            : 'failed',
        );
    }
  };
  useEffect(() => {
    mounted.current = true;
    void checkAccess();
    const onHashChange = () => {
      if (new URLSearchParams(window.location.hash.slice(1)).has('invite')) void checkAccess();
    };
    window.addEventListener('hashchange', onHashChange);
    return () => {
      mounted.current = false;
      generation.current++;
      requests.current.abort();
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);

  const ensureDraft = (token: string, submissionId: string, signal: AbortSignal) => {
    if (!draft.current) {
      const pending = createMailSubmission(token, submissionId, { signal })
        .then(() => undefined)
        .catch((error) => {
          if (draft.current === pending) draft.current = null;
          throw error;
        });
      draft.current = pending;
    }
    return draft.current;
  };
  const upload = async (side: MailImageSide, file: File) => {
    if (statusRef.current !== 'editing' || photoRef.current[side].busy || !session.current) return;
    if (!file.size || file.size > MAX_MAIL_IMAGE_BYTES) {
      updatePhoto(side, {
        error: !file.size ? 'We couldn’t open this photo' : 'Choose a photo smaller than 15 MB',
        file: undefined,
      });
      return;
    }
    const current = generation.current;
    const token = session.current.token;
    const signal = requests.current.signal;
    const submissionId = (id.current ??= crypto.randomUUID());
    const active = () => mounted.current && generation.current === current;
    updatePhoto(side, { file, busy: true, error: undefined });
    setErrors((old) => ({ ...old, [side]: undefined }));
    try {
      await ensureDraft(token, submissionId, signal);
      if (!active()) return;
      const result = await uploadMailImage(token, submissionId, side, file, { signal });
      if (!active()) return;
      const receipt = result[side];
      if (!receipt?.sha256 || receipt.bytes !== file.size)
        throw new MailUploadError(502, 'The response could not be confirmed');
      updatePhoto(side, { receipt, confirmedFile: file, file: undefined, busy: false });
    } catch (error) {
      if (!active()) return;
      if (error instanceof MailUploadError && error.status === 401) setAccess('expired');
      updatePhoto(side, {
        busy: false,
        error:
          error instanceof MailUploadError && error.status === 422
            ? 'We couldn’t open this photo'
            : 'Upload failed',
      });
    }
  };
  const submit = async () => {
    if (!session.current || statusRef.current === 'sending' || statusRef.current === 'saved')
      return;
    const current = photoRef.current;
    if (current.front.busy || current.back.busy) return;
    if (statusRef.current === 'editing') {
      const next: typeof errors = {};
      if (!current.front.receipt || current.front.file || current.front.error)
        next.front = 'Add a front photo';
      if (!current.back.receipt || current.back.file || current.back.error)
        next.back = 'Add a back photo';
      if (likes === null) next.likes = 'Choose Yes or No';
      setErrors(next);
      if (Object.keys(next).length) return;
      payload.current = { likes_ad: likes!, comment };
    }
    const requestGeneration = generation.current;
    const token = session.current.token;
    const submissionId = id.current!;
    const signal = requests.current.signal;
    const active = () => mounted.current && generation.current === requestGeneration;
    updateStatus('sending');
    setFailure('');
    try {
      const result = await submitMailSubmission(token, submissionId, payload.current!, { signal });
      if (!active()) return;
      if (result.status !== 'saved')
        throw new MailUploadError(502, 'The response could not be confirmed');
      updateStatus('saved');
    } catch (error) {
      if (!active()) return;
      if (error instanceof MailUploadError && error.status === 401) setAccess('expired');
      // A lost response may follow a committed save. Reconcile before offering retry.
      try {
        const result = await getMailSubmission(token, submissionId, { signal });
        if (!active()) return;
        if (result.status === 'saved') {
          updateStatus('saved');
          return;
        }
      } catch {
        /* Keep the same payload and UUID for a safe retry. */
      }
      if (!active()) return;
      setFailure('We couldn’t confirm your upload');
      updateStatus('retry');
    }
  };
  const reset = () => {
    if (statusRef.current !== 'saved') return;
    id.current = null;
    draft.current = null;
    payload.current = null;
    photoRef.current = emptyPhotos();
    setPhotos(photoRef.current);
    setLikes(null);
    setComment('');
    setErrors({});
    setFailure('');
    updateStatus('editing');
  };
  return {
    access,
    checkAccess,
    photos,
    likes,
    setLikes,
    comment,
    setComment,
    errors,
    status,
    failure,
    upload,
    submit,
    reset,
  };
}
