import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { denied, reviewRequest } from './api';
import { ReviewAction, reviewStyles as s } from './ReviewControls';
import { centralDate } from './types';

export type ConnectionTarget = {
  label: string;
  target_id: string;
  target_fingerprint: string;
  source_date?: string;
  source_content_hash?: string;
  extraction_version?: string;
  fields: { label: string; value: string }[];
};
export function TargetPreview({
  token,
  kind,
  target,
  stage,
  publicationId,
  role = '',
  moneyOffice = '',
  moneyDistrict = '',
  disabled,
  onTarget,
  onDenied,
}: {
  token: string;
  kind: string;
  target: string;
  stage: string;
  publicationId?: string;
  role?: string;
  moneyOffice?: string;
  moneyDistrict?: string;
  disabled: boolean;
  onTarget(value: ConnectionTarget | null): void;
  onDenied(): void;
}) {
  const [request, setRequest] = useState<{ key: string; attempt: number } | null>(null);
  const [state, setState] = useState<{
    key: string;
    result?: ConnectionTarget;
    error?: boolean;
  } | null>(null);
  const key = JSON.stringify([
    kind,
    target,
    stage,
    publicationId,
    role,
    moneyOffice,
    moneyDistrict,
  ]);
  useEffect(() => {
    onTarget(null);
    setState(null);
  }, [key, onTarget]);
  useEffect(() => {
    if (!request || request.key !== key || !target.trim()) return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      ...(publicationId ? { publication_id: publicationId } : {}),
      election_stage: stage,
      ...(role ? { role } : {}),
      ...(moneyOffice ? { money_office: moneyOffice } : {}),
      ...(moneyDistrict ? { money_district: moneyDistrict } : {}),
    });
    onTarget(null);
    setState({ key });
    void reviewRequest<ConnectionTarget>(
      token,
      `/targets/${encodeURIComponent(kind)}/${encodeURIComponent(target.trim())}?${params}`,
      controller.signal,
    ).then(
      (result) => {
        if (!controller.signal.aborted) {
          setState({ key, result });
          onTarget(result);
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          if (denied(error)) onDenied();
          else setState({ key, error: true });
        }
      },
    );
    return () => controller.abort();
    // Inputs invalidate the preview but do not silently fetch a different target.
  }, [
    request,
    token,
    key,
    kind,
    target,
    stage,
    publicationId,
    role,
    moneyOffice,
    moneyDistrict,
    onTarget,
    onDenied,
  ]);
  const current = state?.key === key ? state : null;
  return (
    <View style={s.stack}>
      <ReviewAction
        label="Inspect connection target"
        disabled={disabled || !target.trim()}
        onPress={() => setRequest((value) => ({ key, attempt: (value?.attempt ?? 0) + 1 }))}
      />
      {current?.result ? (
        <View style={s.card}>
          <Text style={s.label}>{current.result.label}</Text>
          {current.result.source_date ? (
            <Text style={s.note}>Source copied: {centralDate(current.result.source_date)}</Text>
          ) : null}
          {current.result.fields.map((field, index) => (
            <Text key={index} style={s.body}>
              {field.label}: {field.value}
            </Text>
          ))}
          {current.result.source_content_hash ? (
            <Text selectable style={s.note}>
              Retained source contents: {current.result.source_content_hash}
            </Text>
          ) : null}
          <Text style={s.note}>
            The record above is the proposed target. Its presence does not establish a connection to
            this station file.
          </Text>
        </View>
      ) : current?.error ? (
        <Text style={s.body}>
          We couldn’t load this target. Check its exact identity and try again.
        </Text>
      ) : current ? (
        <Text style={s.body}>Loading the exact target…</Text>
      ) : null}
    </View>
  );
}
