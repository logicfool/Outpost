import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { requestDiagnostics } from '../core/diagnostics';
import { Button } from './components';
import { useTheme, type Palette } from './theme';
export function DiagnosticsPanel() {
  const { C, S, isDark } = useTheme();

  const [open, setOpen] = useState(false),
    [rows, setRows] = useState(requestDiagnostics);
  return (
    <View style={{ gap: 10 }}>
      <Button
        secondary
        title={open ? 'Hide connection diagnostics' : 'Connection diagnostics'}
        onPress={() => {
          setRows(requestDiagnostics());
          setOpen(!open);
        }}
      />
      {open && (
        <View style={S.card}>
          <Text style={S.small}>
            Local request metadata only. No tokens, IDs, names or message contents.
          </Text>
          <Button
            secondary
            title="Refresh diagnostics"
            onPress={() => setRows(requestDiagnostics())}
          />
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
        </View>
      )}
    </View>
  );
}
