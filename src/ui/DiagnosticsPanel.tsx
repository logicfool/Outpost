import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { requestDiagnostics, clearDiagnostics } from '../core/diagnostics';
import {
  diagnosticCaptureStatus,
  subscribeDiagnostics,
  startDetailedDiagnostics,
  stopDetailedDiagnostics,
  detailedDiagnosticReport,
  flushDetailedDiagnostics,
} from '../core/detailedDiagnostics';
import { saveDiagnosticFile } from '../platform/diagnosticExport';
import { diagnosticContext } from '../platform/diagnosticContext';
import type { AppModel } from '../state/useApp';
import { AppError, safeError } from '../core/validation';
import { Button } from './components';
import { useTheme } from './theme';
export function DiagnosticsPanel({ model }: { model: AppModel }) {
  const { C, S } = useTheme();
  const [open, setOpen] = useState(false),
    [rows, setRows] = useState(requestDiagnostics),
    [status, setStatus] = useState(diagnosticCaptureStatus);
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [preview, setPreview] = useState('');
  const active = useRef(model.active?.puuid),
    alive = useRef(true),
    lock = useRef(false);
  active.current = model.active?.puuid;
  useEffect(() => {
    alive.current = true;
    const unsubscribe = subscribeDiagnostics(() => setStatus(diagnosticCaptureStatus()));
    const timer = setInterval(() => setStatus(diagnosticCaptureStatus()), 5000);
    return () => {
      alive.current = false;
      unsubscribe();
      clearInterval(timer);
    };
  }, []);
  const refresh = () => {
    setRows(requestDiagnostics());
    setStatus(diagnosticCaptureStatus());
  };
  const exportFile = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    const id = active.current,
      generation = diagnosticCaptureStatus().generation;
    const guard = () => {
      if (
        !alive.current ||
        active.current !== id ||
        diagnosticCaptureStatus().generation !== generation
      )
        throw new AppError(
          'ACCOUNT_CHANGED',
          'The account or capture changed. Export again from this account.',
        );
    };
    try {
      await flushDetailedDiagnostics();
      guard();
      const context = await diagnosticContext(model, guard);
      guard();
      const report = detailedDiagnosticReport(context, requestDiagnostics());
      const file =
        'Outpost-diagnostics-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
      const result = await saveDiagnosticFile(JSON.stringify(report), file, guard);
      if (alive.current) setMessage(result);
    } catch (e) {
      if (alive.current) setMessage(safeError(e).message);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <View style={{ gap: 10 }}>
      <Button
        secondary
        title={open ? 'Hide connection diagnostics' : 'Connection diagnostics'}
        onPress={() => {
          refresh();
          setOpen(!open);
        }}
      />
      {open && (
        <View style={S.card}>
          <Text style={S.h3}>Diagnostics</Text>
          <Text style={S.small}>
            {status.active ? 'Detailed capture is on' : 'Detailed capture is off'} - {status.count}{' '}
            records - {(status.bytes / 1048576).toFixed(1)} MiB
          </Text>
          {status.active && (
            <Text style={S.small}>
              Stops at {new Date(status.expiresAt).toLocaleTimeString()}. Reproduce the issue, then
              export.
            </Text>
          )}
          {status.droppedRecords > 0 && (
            <Text style={[S.small, { color: C.gold }]}>
              {status.droppedRecords} records exceeded the capture limits. The export notes all
              omissions.
            </Text>
          )}
          {status.active ? (
            <Button
              secondary
              title="Stop detailed capture"
              disabled={busy}
              onPress={() => {
                stopDetailedDiagnostics();
                refresh();
              }}
            />
          ) : (
            <Button
              secondary
              title="Start detailed capture"
              disabled={busy}
              onPress={() => setConfirm(true)}
            />
          )}
          {confirm && (
            <View style={{ gap: 10 }}>
              <Text style={S.body}>
                Include request/response headers, bodies, settings and chat messages. Tokens,
                cookies and passwords are redacted. Share the file privately.
              </Text>
              <Text style={S.small}>
                Captures locally for 20 minutes or until you switch accounts. Up to 2 MiB per body
                and 16 MiB in total; larger bodies are marked, not silently cut.
              </Text>
              <Button
                title="Start capture for 20 minutes"
                onPress={() => {
                  startDetailedDiagnostics();
                  setConfirm(false);
                  setPreview('');
                  setMessage('Capture started. Reproduce the issue, then return here to export.');
                  refresh();
                }}
              />
              <Button secondary title="Cancel detailed capture" onPress={() => setConfirm(false)} />
            </View>
          )}
          <Button
            title={busy ? 'Preparing diagnostic file...' : 'Export diagnostics (JSON)'}
            icon="download"
            disabled={busy}
            onPress={() => void exportFile()}
          />
          <Button secondary title="Refresh diagnostics" disabled={busy} onPress={refresh} />
          <Button
            secondary
            title="View captured detail"
            disabled={busy || !status.count}
            onPress={() => {
              const report = detailedDiagnosticReport({}, []);
              setPreview(JSON.stringify(report.events.slice(-3), null, 2).slice(0, 12000));
            }}
          />
          {preview && (
            <>
              <Text selectable style={[S.small, { fontFamily: 'monospace' }]}>
                {preview}
              </Text>
              <Text style={S.small}>
                Preview limited to 12,000 characters. Export includes all retained records.
              </Text>
              <Button secondary title="Hide captured detail" onPress={() => setPreview('')} />
            </>
          )}
          <Text selectable style={[S.small, { fontFamily: 'monospace' }]}>
            {rows.length
              ? rows
                  .map(
                    (r) =>
                      `${r.service} · ${r.method} ${r.status ?? '-'} · ${r.code} · ${r.mime ?? '-'}/${r.shape ?? '-'} · ${r.durationMs}ms`,
                  )
                  .join('\n')
              : 'No requests in this session.'}
          </Text>
          <Button
            secondary
            title="Clear diagnostics"
            disabled={busy}
            onPress={() => {
              clearDiagnostics();
              setPreview('');
              setMessage('Local diagnostic records cleared.');
              refresh();
            }}
          />
          {message && (
            <Text accessibilityRole="alert" style={[S.small, { color: C.gold }]}>
              {message}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}
