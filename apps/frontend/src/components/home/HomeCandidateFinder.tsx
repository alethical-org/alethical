import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Image, Platform } from 'react-native';
import type { CandidateFlow } from '../candidates/candidateFlow';
import { useResponsive } from '../../hooks/useResponsive';
import { browserFillInputProps } from '../../theme/browserFill';
import { AlertCircle, MapPin } from '../icons';
import { LinkArrow } from '../LinkArrow';

const loadCandidates = () => import('../../data/candidates');
type CandidateModule = Awaited<ReturnType<typeof loadCandidates>>;
const messages = {
  empty: 'Enter your full Minnesota street address',
  'no-match': 'We couldn’t match that address. Check the street address, city, and ZIP code.',
  failed: 'We couldn’t complete your search. Please try again.',
};

/** Keep the address in temporary app memory and load the search only on submit. */
export function HomeCandidateFinder({
  onNavigate,
  load = loadCandidates,
}: {
  onNavigate(): void;
  load?: () => Promise<CandidateModule>;
}) {
  const { isMobile, isTablet } = useResponsive();
  const id = useId().replace(/:/g, '');
  const input = useRef<HTMLTextAreaElement>(null);
  const active = useRef(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const flow = useRef<CandidateFlow | null>(null);
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<keyof typeof messages | null>(null);
  const invalid = error === 'empty' || error === 'no-match';
  const fitAddress = () => {
    const field = input.current;
    if (!field) return;
    field.style.height = '0px';
    field.style.height = `${field.scrollHeight}px`;
  };
  useLayoutEffect(fitAddress, [address, isMobile, isTablet]);
  useEffect(() => {
    const field = input.current;
    if (!field || typeof ResizeObserver === 'undefined') return;
    let width = -1;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width !== width) {
        width = entry.contentRect.width;
        fitAddress();
      }
    });
    observer.observe(field.parentElement ?? field);
    return () => observer.disconnect();
  }, []);
  useEffect(
    () => () => {
      generation.current += 1;
      controller.current?.abort();
      const current = flow.current;
      if (current && ['loading', 'updating'].includes(current.getState().status))
        current.setDraftAddress(current.getState().draftAddress);
    },
    [],
  );

  const submit = async () => {
    if (active.current) return;
    const value = address.trim();
    // Only check for a house number and street. The server owns the exact match.
    if (!/^\d+\S*\s+\S/.test(value)) {
      setError('empty');
      input.current?.focus();
      return;
    }
    active.current = true;
    setBusy(true);
    setError(null);
    const token = ++generation.current;
    const abort = new AbortController();
    controller.current = abort;
    try {
      const module = await load();
      if (token !== generation.current) return;
      const elections = await module.candidateSearchServices.getElections(abort.signal);
      if (token !== generation.current) return;
      const election = elections[0];
      if (!election) throw new Error('No supported election');
      module.handoffCandidateAddress(value);
      flow.current = module.candidateFlow;
      await module.candidateFlow.search({ address: value, electionId: election.id }, election);
      if (token !== generation.current) return;
      const state = module.candidateFlow.getState();
      if (
        state.status === 'success' &&
        state.requested?.address === value &&
        state.requested.electionId === election.id &&
        (state.outcome?.kind === 'ambiguous' ||
          (!state.outcome && state.displayed?.request.address === value))
      ) {
        onNavigate();
      } else if (
        state.outcome?.kind === 'no-match' ||
        state.outcome?.kind === 'outside-minnesota'
      ) {
        setError('no-match');
      } else {
        setError('failed');
      }
    } catch {
      if (token === generation.current) setError('failed');
    } finally {
      if (token === generation.current) {
        active.current = false;
        setBusy(false);
        controller.current = null;
      }
    }
  };
  if (Platform.OS !== 'web') return null;
  const outline = !isMobile ? (
    <Image
      source={require('../../../assets/mn-outline-candidates.svg')}
      accessible={false}
      aria-hidden
      testID="home-candidate-outline"
      style={{ width: isTablet ? 150 : 300, height: isTablet ? 165 : 330 }}
    />
  ) : null;
  const copy = (
    <div className="hc-copy">
      <h2 id={`${id}-title`}>Who’s running where you live?</h2>
      <p>Enter your Minnesota street address to see who is running for office in your area</p>
    </div>
  );
  const form = (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label htmlFor={`${id}-address`}>Full street address</label>
      <div className="hc-row">
        <div className="hc-field" data-invalid={invalid}>
          {!isMobile ? <MapPin size={22} color="#6f756f" aria-hidden /> : null}
          <textarea
            ref={input}
            id={`${id}-address`}
            {...browserFillInputProps}
            autoComplete="street-address"
            enterKeyHint="search"
            rows={1}
            placeholder="Street address, city, MN ZIP"
            value={address}
            readOnly={busy}
            aria-invalid={invalid}
            aria-describedby={`${id}-message ${id}-help ${id}-privacy`}
            onChange={(event) => {
              setAddress(event.target.value.replace(/[\r\n]+/g, ' '));
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submit();
              }
            }}
            onFocus={() => {
              // The pair has a scroll margin to leave room above a phone keyboard.
              if (isMobile) input.current?.closest('form')?.scrollIntoView({ block: 'nearest' });
            }}
          />
        </div>
        <button type="submit" disabled={busy} aria-disabled={busy} aria-busy={busy}>
          {busy ? 'Finding candidates…' : error === 'failed' ? 'Try again' : 'Find my candidates'}
          {!busy ? <LinkArrow color="#0f7a45" /> : null}
        </button>
      </div>
      <div id={`${id}-message`} className="hc-message" aria-live="polite">
        {error ? (
          <div>
            <AlertCircle size={18} color="#b42318" aria-hidden />
            <span>{messages[error]}</span>
          </div>
        ) : null}
      </div>
      <p id={`${id}-help`} className="hc-help">
        A city or ZIP code alone cannot identify your local races
      </p>
      <p id={`${id}-privacy`} className="hc-help hc-privacy">
        Your address is sent to Minnesota government services for this lookup. Alethical does not
        save it.
      </p>
    </form>
  );
  return (
    <section className="hc-finder" aria-labelledby={`${id}-title`}>
      <style>{css}</style>
      {isTablet ? (
        <>
          <div className="hc-layout">
            {copy}
            {outline}
          </div>
          {form}
        </>
      ) : (
        <div className="hc-layout">
          <div className="hc-main">
            {copy}
            {form}
          </div>
          {outline}
        </div>
      )}
    </section>
  );
}

const css = `
.hc-finder{box-sizing:border-box;position:relative;margin-top:96px;padding:96px 56px 40px;background:linear-gradient(180deg,#eaf6ef 0%,#f2f9f5 45%,rgba(251,252,253,0) 100%);font-family:'Libre Franklin',Helvetica,Arial,sans-serif;color:#11150f;isolation:isolate}
.hc-finder::before{content:'';position:absolute;inset:0;z-index:-1;pointer-events:none;background-image:radial-gradient(rgba(20,157,91,.09) 1.3px,transparent 1.4px);background-size:30px 30px;mask-image:linear-gradient(to bottom,transparent 0%,#000 36%,transparent 88%)}
.hc-finder *{box-sizing:border-box}.hc-layout{display:grid;grid-template-columns:minmax(0,min(820px,calc(100% - 356px))) minmax(0,1fr);gap:56px;align-items:center}.hc-layout>[data-testid]{justify-self:center}.hc-main,.hc-copy{min-width:0}
.hc-copy h2{margin:0;font-size:44px;line-height:1.06;font-weight:800;letter-spacing:-.02em;text-wrap:pretty}.hc-copy p{margin:18px 0 0;max-width:680px;font-size:21px;line-height:1.5;color:#4f5651;text-wrap:pretty}
.hc-finder form{margin-top:34px;scroll-margin-bottom:96px}.hc-finder label{display:block;margin:0 0 10px;font-size:16px;font-weight:700;color:#2c322c}.hc-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.hc-field{flex:1 1 360px;min-width:0;display:flex;align-items:center;gap:12px;min-height:60px;padding:0 20px;background:#fff;border:1px solid rgba(17,21,15,.22);border-radius:14px;transition:border-color .18s ease,box-shadow .18s ease}.hc-field:focus-within{border-color:#5b30d6;box-shadow:0 0 0 4px rgba(91,48,214,.14)}.hc-field[data-invalid=true]{border-color:#c0392b}.hc-field[data-invalid=true]:focus-within{box-shadow:0 0 0 4px rgba(192,57,43,.12)}
.hc-field textarea{flex:1;min-width:0;background:transparent;border:none;outline:none;color:#11150f;font:inherit;font-size:18px;line-height:24px;min-height:60px;padding:18px 0;resize:none;overflow:hidden}.hc-field textarea::placeholder{color:#6f756f}
.hc-row button{flex:none;width:248px;min-height:60px;display:inline-flex;align-items:center;justify-content:center;gap:10px;padding:12px 24px;background:#fff;border:1px solid rgba(17,21,15,.16);border-radius:14px;color:#11150f;font:inherit;font-size:17px;font-weight:700;white-space:nowrap;cursor:pointer}.hc-row button:focus-visible{outline:2px solid #7c5cff;outline-offset:2px}.hc-row button:active:not(:disabled){background:#eceeed;border-color:rgba(17,21,15,.3)}.hc-row button:disabled{color:#4f5651;cursor:progress}
.hc-message{min-height:0}.hc-message>div{display:flex;gap:8px;align-items:flex-start;margin-top:12px;font-size:15px;line-height:1.45;font-weight:600;color:#b42318}.hc-message svg{flex:none;margin-top:1px}.hc-finder .hc-help{margin:12px 0 0;font-size:15px;line-height:1.45;color:#4f5651}.hc-finder .hc-privacy{max-width:680px}
@media(hover:hover) and (pointer:fine) and (min-width:768px){.hc-row button:hover:not(:disabled){background:#f7f8fa;border-color:rgba(17,21,15,.3)}}
@media(prefers-reduced-motion:reduce){.hc-field{transition:none}}
@media(min-width:768px) and (max-width:1099px){.hc-finder{margin-top:80px;padding:80px 40px 32px}.hc-layout{grid-template-columns:minmax(0,1fr) 150px;gap:40px}.hc-copy h2{font-size:36px;line-height:1.08}.hc-field{flex-basis:300px}}
@media(max-width:767px){.hc-finder{margin-top:0;padding:48px 20px}.hc-layout{display:block}.hc-copy h2{font-size:30px;line-height:1.08}.hc-finder form{margin-top:26px}.hc-finder label{font-size:19px}.hc-row{display:block}.hc-field{min-height:58px;padding:0 16px}.hc-field textarea{font-size:17px;min-height:58px;padding:17px 0}.hc-row button{width:100%;min-height:58px;margin-top:12px;font-size:19px}.hc-message>div,.hc-finder .hc-help{font-size:17px}}
`;
