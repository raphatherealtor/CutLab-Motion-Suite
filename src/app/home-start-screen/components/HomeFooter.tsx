import React from 'react';

export default function HomeFooter() {
  return (
    <footer
      style={{
        flexShrink: 0,
        borderTop: '1px solid var(--color-border)',
        padding: '8px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        backgroundColor: 'var(--color-surface)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span className="status-jewel jewel-ok" aria-hidden="true" />
        <span style={{ fontSize: '11px', color: 'var(--color-subtle)' }}>Engine ready</span>
      </div>
      <span style={{ fontSize: '11px', color: 'var(--color-subtle)', opacity: 0.4 }}>·</span>
      <span style={{ fontSize: '11px', color: 'var(--color-subtle)' }}>
        Local · No account · No cloud
      </span>
      <div style={{ flex: 1 }} />
      <span
        style={{
          fontSize: '11px',
          color: 'var(--color-subtle)',
          fontFamily: 'var(--font-mono)',
        }}
      >
        CutLab Studio 1.0.0
      </span>
    </footer>
  );
}