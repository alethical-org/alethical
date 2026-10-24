import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { denied, reviewImage } from './api';
import { ReviewAction, reviewStyles as s } from './ReviewControls';
import type { Redaction } from './types';

/** Unmount on identity changes. Blob URLs are never stored and always revoked. */
export function ReviewImage({
  token,
  path,
  label,
  redactions = [],
  onDenied,
  onLoaded,
}: {
  token: string;
  path: string;
  label: string;
  redactions?: Redaction[];
  onDenied(): void;
  onLoaded?(): void;
}) {
  const [result, setResult] = useState<{ path: string; url: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setResult(null);
    setFailed(false);
    void reviewImage(token, path, controller.signal).then(
      (url) => {
        objectUrl = url;
        if (controller.signal.aborted) URL.revokeObjectURL(url);
        else setResult({ path, url });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          if (denied(error)) onDenied();
          else setFailed(true);
        }
      },
    );
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [token, path, attempt, onDenied]);
  const url = result?.path === path ? result.url : null;
  return (
    <View style={s.stack}>
      <Text style={s.label}>{label}</Text>
      {url ? (
        <div style={{ position: 'relative', width: '100%', maxWidth: 1100, margin: '0 auto' }}>
          <img
            src={url}
            alt={label}
            onLoad={onLoaded}
            style={{ display: 'block', width: '100%', height: 'auto' }}
          />
          {redactions.map((area, i) => (
            <div
              key={i}
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: `${area.x * 100}%`,
                top: `${area.y * 100}%`,
                width: `${area.width * 100}%`,
                height: `${area.height * 100}%`,
                border: '2px solid #c23c36',
                backgroundColor: 'rgba(194,60,54,.25)',
                boxSizing: 'border-box',
                pointerEvents: 'none',
              }}
            />
          ))}
        </div>
      ) : failed ? (
        <>
          <Text style={s.body}>We couldn’t load this page image</Text>
          <ReviewAction label="Retry image" onPress={() => setAttempt((value) => value + 1)} />
        </>
      ) : (
        <Text style={s.body} accessibilityLiveRegion="polite">
          Loading page image…
        </Text>
      )}
    </View>
  );
}
