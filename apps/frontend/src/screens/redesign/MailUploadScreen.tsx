import { createElement as h, useEffect, useRef, useState } from 'react';
import { ScrollView } from 'react-native';
import { useMailUpload, type PhotoState } from '../../hooks/useMailUpload';
import { type MailImageSide } from '../../data/mailUpload';
import type { MenuKey } from '../../navigation/ia';
import type { RootScreenProps } from '../../navigation/types';
import { navigateTopNavItem } from '../../navigation/topNavRoutes';
import { Footer, PageBackground, TopNav } from '../../theme/primitives';

const css = `
.mail-upload{box-sizing:border-box;width:100%;max-width:1248px;margin:0 auto;padding:40px 32px 80px;color:#11150f;font-family:'Libre Franklin',sans-serif}
.mail-upload *{box-sizing:border-box}.mail-upload h1{font-size:44px;line-height:1.1;letter-spacing:-1.1px;font-weight:800;margin:0}.mail-upload .intro{margin:12px 0 32px;max-width:640px;font-size:18px;line-height:1.5;color:#4f5651;text-wrap:pretty}
.mail-upload .columns{display:grid;grid-template-columns:minmax(0,1fr) 400px;gap:56px}.mail-upload .photos{display:grid;grid-template-columns:repeat(auto-fit,minmax(128px,1fr));gap:20px;align-items:start}
.mail-upload .label,.mail-upload legend{font-size:17px;font-weight:700;line-height:1.4}.mail-upload .photo label{display:block;margin-bottom:10px}
.mail-upload .image{aspect-ratio:4/3;border:1px solid rgba(17,21,15,.14);border-radius:12px;background:#f4f5f7;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;margin-bottom:10px}
.mail-upload .image img{height:100%;width:100%;object-fit:contain}.mail-upload .image.confirmed img{opacity:.38}.mail-upload .check{display:flex;align-items:center;justify-content:center;border-radius:50%;background:#2ed47e;color:#06231a;width:64px;height:64px;flex-shrink:0}
.mail-upload .image .check{width:34%;max-width:76px;height:auto;aspect-ratio:1;box-shadow:0 4px 14px rgba(6,35,26,.22);position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)}
.mail-upload .image .check svg{width:52%;height:52%}.mail-upload button{font:700 17px/1.35 'Libre Franklin',sans-serif;color:#11150f;background:white;border:1px solid rgba(17,21,15,.18);border-radius:12px;min-height:48px;padding:12px 16px;cursor:pointer}
.mail-upload button:hover:not(:disabled){background:#f7f8fa;border-color:rgba(17,21,15,.3)}.mail-upload button:active:not(:disabled){background:#e4eee8}.mail-upload button:focus-visible,.mail-upload input:focus-visible+span{outline:3px solid rgba(91,48,214,.55);outline-offset:3px}
.mail-upload button:disabled{cursor:default;opacity:.6}.mail-upload .photo button{width:100%;font-size:16px;line-height:1.3;padding:11px 12px}.mail-upload .photo button+button{margin-top:8px}
.mail-upload fieldset{border:0;padding:0;margin:0 0 28px;min-width:0}.mail-upload legend{margin-bottom:12px;padding:0}
.mail-upload .choices{display:flex;gap:12px}.mail-upload .choices label{position:relative;flex:1}.mail-upload .choices input{position:absolute;opacity:0;width:1px;height:1px}
.mail-upload .choices label>span{display:flex;align-items:center;justify-content:center;gap:8px;min-height:52px;padding:10px 12px;border:1px solid rgba(17,21,15,.18);border-radius:12px;font-size:17px;font-weight:700;cursor:pointer;background:white}
.mail-upload .choice-mark{flex:none}
.mail-upload .choices input:checked+span{padding-right:26px;background:#11332a;color:white;border-color:#11332a}.mail-upload .choices input:not(:disabled)+span:hover{box-shadow:inset 0 0 0 1px #658370}.mail-upload .choices input:disabled+span{cursor:default}
.mail-upload .label-row{display:block}.mail-upload .optional{display:block;margin-top:2px;font-size:15px;color:#656c66}.mail-upload .helper{margin:8px 0 10px;font-size:15px;line-height:1.5;color:#4f5651}
.mail-upload textarea{display:block;width:100%;min-height:104px;resize:vertical;border:1px solid rgba(17,21,15,.18);border-radius:12px;padding:14px 16px;font:17px/1.5 'Libre Franklin',sans-serif;color:#11150f;background:white}
.mail-upload textarea:focus{outline:0;border-color:#5b30d6;box-shadow:0 0 0 3px rgba(91,48,214,.22)}.mail-upload textarea:disabled{opacity:.8}
.mail-upload .submit-area{margin-top:28px}.mail-upload button.primary{width:240px;background:#2ed47e;border-color:transparent;min-height:52px}.mail-upload button.primary:hover:not(:disabled){background:#20bd6e}.mail-upload button.primary:active:not(:disabled){background:#1aab61}
.mail-upload .privacy{font-size:15px;line-height:1.5;color:#4f5651;margin:16px 0 0}.mail-upload .error{font-size:14px;line-height:1.5;color:#8f5a12;margin:8px 0}.mail-upload .failure{color:#a32828;background:#fff2f0;border-radius:10px;padding:12px;margin-bottom:12px;font-size:15px;line-height:1.5}
.mail-upload .success{width:360px;max-width:100%;padding:32px 28px;border:1px solid #bfeacf;border-radius:16px;background:#f2f9f5;text-align:center;display:flex;flex-direction:column;align-items:center}
.mail-upload .success .check{width:52px;height:52px}.mail-upload .success h2{font-size:26px;line-height:1.2;font-weight:800;margin:12px 0 18px}.mail-upload .success button{white-space:nowrap;font-size:16px;padding:13px 22px}.mail-upload .success h2:focus{outline:none}
.mail-upload .spinner-wrap{position:absolute;background:white;width:44px;height:44px;border-radius:50%;box-shadow:0 2px 10px rgba(17,21,15,.18);display:flex;align-items:center;justify-content:center}.mail-upload .photo-failure{margin:10px 0;color:#8f2a20;background:#fdecec;border:1px solid #f4c9c6;border-radius:12px;padding:10px 12px;font-size:14px;line-height:1.5;font-weight:600}.mail-upload .spinner{width:28px;height:28px;border:3px solid #ced8d1;border-top-color:#11332a;border-radius:50%;animation:mail-spin .8s linear infinite;position:absolute}.mail-upload .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@keyframes mail-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.mail-upload .spinner{animation:none}}
@media(max-width:1099px){.mail-upload{max-width:720px}.mail-upload .columns{grid-template-columns:1fr;gap:28px}.mail-upload .photos{gap:12px}.mail-upload h1{font-size:36px}}
@media(max-width:767px){.mail-upload{padding:28px 22px 40px}.mail-upload h1{font-size:30px;line-height:1.1;letter-spacing:-.6px;margin-bottom:0}.mail-upload .intro{font-size:17px;margin:10px 0 24px}.mail-upload button.primary{width:100%}.mail-upload .success{width:100%;padding:28px 20px}.mail-upload .success h2{font-size:24px}.mail-upload .success .check{width:48px;height:48px}}
@media(max-width:280px){.mail-upload .photos{grid-template-columns:1fr}.mail-upload .choices{flex-wrap:wrap}.mail-upload .choices label{min-width:70px}}
`;

function Check({ size = 34 }: { size?: number }) {
  return h(
    'div',
    { className: 'check', 'aria-hidden': true },
    h(
      'svg',
      { width: size, height: size, viewBox: '0 0 24 24', fill: 'none' },
      h('path', {
        d: 'M5 12.5 10 17.5 19 7',
        stroke: 'currentColor',
        strokeWidth: 2.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }),
    ),
  );
}
function Camera() {
  return h(
    'svg',
    {
      width: 30,
      height: 30,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: '#535d56',
      strokeWidth: 1.8,
      'aria-hidden': true,
    },
    h('path', {
      d: 'M8 5l1.5-2h5L16 5h3a2 2 0 012 2v12H3V7a2 2 0 012-2z',
      strokeLinejoin: 'round',
    }),
    h('circle', { cx: 12, cy: 12, r: 4 }),
  );
}

function Photo({
  side,
  photo,
  error,
  locked,
  upload,
}: {
  side: MailImageSide;
  photo: PhotoState;
  error?: string;
  locked: boolean;
  upload: (side: MailImageSide, file: File) => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string>();
  const [previewFailed, setPreviewFailed] = useState(false);
  const file = photo.busy ? photo.file : (photo.confirmedFile ?? photo.file);
  const confirmed = !!photo.receipt && !photo.busy && !photo.error && !photo.file;
  const label = side === 'front' ? 'Front' : 'Back';
  useEffect(() => {
    setPreviewFailed(false);
    if (!file) {
      setPreview(undefined);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return h(
    'div',
    { className: 'photo', role: 'group', 'aria-labelledby': `${side}-label` },
    h('label', { className: 'label', id: `${side}-label` }, label),
    h(
      'div',
      { className: `image${confirmed ? ' confirmed' : ''}` },
      preview && !previewFailed
        ? h('img', { src: preview, alt: '', onError: () => setPreviewFailed(true) })
        : h(Camera),
      photo.busy
        ? h(
            'div',
            { className: 'spinner-wrap', 'aria-hidden': true },
            h('div', { className: 'spinner' }),
          )
        : confirmed
          ? h(Check)
          : null,
    ),
    h(
      'span',
      { className: 'sr-only', role: 'status' },
      photo.busy ? `${label} photo uploading` : confirmed ? `${label} photo uploaded` : '',
    ),
    h('input', {
      ref: input,
      type: 'file',
      accept: 'image/*',
      hidden: true,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
        const chosen = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (chosen) void upload(side, chosen);
      },
    }),
    photo.error
      ? h(
          'p',
          { className: photo.file ? 'photo-failure' : 'error', role: 'alert', id: `${side}-error` },
          photo.error,
        )
      : null,
    photo.error && photo.file
      ? h(
          'button',
          {
            type: 'button',
            disabled: locked || photo.busy,
            onClick: () => void upload(side, photo.file!),
            id: `${side}-retry`,
            'aria-label': `Try ${side} photo again`,
          },
          'Try again',
        )
      : null,
    h(
      'button',
      {
        id: `${side}-photo`,
        type: 'button',
        disabled: locked || photo.busy,
        onClick: () => input.current?.click(),
        'aria-label': `${file || photo.receipt ? 'Replace' : 'Add'} ${side} photo`,
        'aria-describedby': photo.error ? `${side}-error` : error ? `${side}-required` : undefined,
      },
      file || photo.receipt ? 'Replace photo' : 'Add photo',
    ),
    error && !photo.error ? h('p', { className: 'error', id: `${side}-required` }, error) : null,
  );
}

export function MailUploadScreen({ navigation }: RootScreenProps<'MailUpload'>) {
  const form = useMailUpload();
  const [openMenu, setOpenMenu] = useState<MenuKey | null>(null);
  const savedHeading = useRef<HTMLHeadingElement>(null);
  const locked = form.status !== 'editing';
  const photoBusy = form.photos.front.busy || form.photos.back.busy;
  useEffect(() => {
    if (form.status === 'saved') savedHeading.current?.focus();
  }, [form.status]);
  useEffect(() => {
    const first = form.errors.front
      ? 'front-photo'
      : form.errors.back
        ? 'back-photo'
        : form.errors.likes
          ? 'mail-yes'
          : null;
    if (first) {
      const retry = first.endsWith('-photo')
        ? document.getElementById(first.replace('-photo', '-retry'))
        : null;
      (retry ?? document.getElementById(first))?.focus();
    }
  }, [form.errors]);
  const content =
    form.access === 'loading'
      ? h('p', { role: 'status' }, 'Loading…')
      : form.access === 'expired' || form.access === 'missing'
        ? null
        : form.access === 'failed'
          ? h(
              'div',
              null,
              h('p', { role: 'alert' }, 'This demo is unavailable'),
              h('button', { onClick: () => void form.checkAccess() }, 'Try again'),
            )
          : form.status === 'saved'
            ? h(
                'section',
                { className: 'success', 'aria-labelledby': 'mail-saved' },
                h(Check, { size: 28 }),
                h('h2', { id: 'mail-saved', ref: savedHeading, tabIndex: -1 }, 'Saved'),
                h('button', { onClick: form.reset }, 'Upload another'),
              )
            : h(
                'form',
                {
                  noValidate: true,
                  onSubmit: (event: React.FormEvent) => {
                    event.preventDefault();
                    void form.submit();
                  },
                },
                h(
                  'div',
                  { className: 'columns' },
                  h(
                    'div',
                    { className: 'photos' },
                    ...(['front', 'back'] as const).map((side) =>
                      h(Photo, {
                        key: side,
                        side,
                        photo: form.photos[side],
                        error: form.errors[side],
                        locked,
                        upload: form.upload,
                      }),
                    ),
                  ),
                  h(
                    'div',
                    null,
                    h(
                      'fieldset',
                      { disabled: locked },
                      h('legend', null, 'Do you like this ad?'),
                      h(
                        'div',
                        { className: 'choices' },
                        ...([true, false] as const).map((value) =>
                          h(
                            'label',
                            { key: String(value) },
                            h('input', {
                              type: 'radio',
                              name: 'likes-ad',
                              id: value ? 'mail-yes' : 'mail-no',
                              checked: form.likes === value,
                              onChange: () => form.setLikes(value),
                              'aria-describedby': form.errors.likes
                                ? 'mail-likes-error'
                                : undefined,
                            }),
                            h(
                              'span',
                              null,
                              form.likes === value
                                ? h(
                                    'svg',
                                    {
                                      className: 'choice-mark',
                                      width: 18,
                                      height: 18,
                                      viewBox: '0 0 24 24',
                                      fill: 'none',
                                      'aria-hidden': true,
                                    },
                                    h('path', {
                                      d: 'M5 12.5 L10 17.5 L19 7',
                                      stroke: 'currentColor',
                                      strokeWidth: 2.6,
                                      strokeLinecap: 'round',
                                      strokeLinejoin: 'round',
                                    }),
                                  )
                                : null,
                              h('span', { className: 'choice-text' }, value ? 'Yes' : 'No'),
                            ),
                          ),
                        ),
                      ),
                      form.errors.likes
                        ? h('p', { className: 'error', id: 'mail-likes-error' }, form.errors.likes)
                        : null,
                    ),
                    h(
                      'div',
                      { className: 'label-row' },
                      h(
                        'label',
                        { className: 'label', htmlFor: 'mail-comment' },
                        'Anything you’d like to share?',
                      ),
                      h('span', { className: 'optional', id: 'mail-optional' }, 'Optional'),
                    ),
                    h(
                      'p',
                      { className: 'helper', id: 'mail-helper' },
                      'e.g. how you feel about this mail or how our tool could be more helpful',
                    ),
                    h('textarea', {
                      id: 'mail-comment',
                      rows: 3,
                      maxLength: 4000,
                      disabled: locked,
                      value: form.comment,
                      'aria-describedby': 'mail-optional mail-helper',
                      onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) =>
                        form.setComment(event.target.value.replace(/\0/g, '')),
                    }),
                    h(
                      'div',
                      { className: 'submit-area' },
                      form.failure
                        ? h('div', { className: 'failure', role: 'alert' }, form.failure)
                        : null,
                      h(
                        'button',
                        {
                          className: 'primary',
                          type: 'submit',
                          disabled: form.status === 'sending' || photoBusy,
                          'aria-busy': form.status === 'sending' || photoBusy,
                        },
                        form.status === 'sending'
                          ? 'Submitting…'
                          : form.status === 'retry'
                            ? 'Try again'
                            : 'Submit',
                      ),
                      h(
                        'p',
                        { className: 'privacy' },
                        'Your photos and comments stay private to Alethical',
                      ),
                    ),
                  ),
                ),
              );
  return (
    <PageBackground>
      <ScrollView keyboardShouldPersistTaps="handled">
        <TopNav
          openMenu={openMenu}
          onOpenMenuChange={setOpenMenu}
          onNavigate={(item) => {
            if (navigateTopNavItem(navigation, item)) setOpenMenu(null);
          }}
          onHome={() => navigation.navigate('Tabs', { screen: 'Home' })}
        />
        {h(
          'main',
          { className: 'mail-upload' },
          h('style', null, css),
          h(
            'h1',
            null,
            form.access === 'expired'
              ? 'This demo link is no longer available'
              : form.access === 'missing'
                ? 'Open your invitation link to continue'
                : 'Upload political mail',
          ),
          form.access !== 'expired' && form.access !== 'missing'
            ? h(
                'p',
                { className: 'intro' },
                'See who paid for this mail and what public records show about them',
              )
            : null,
          content,
        )}
        <Footer
          onPrivacy={() => navigation.navigate('Privacy')}
          onTerms={() => navigation.navigate('Terms')}
        />
      </ScrollView>
    </PageBackground>
  );
}
