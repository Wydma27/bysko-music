import React from 'react';
import { AlertTriangleIcon } from './Icons';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('BySko Music crashed:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="loading-screen">
        <span style={{ fontSize: '3rem', color: 'var(--danger, #e74c3c)' }}><AlertTriangleIcon /></span>
        <p>Coś poszło nie tak</p>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', maxWidth: 420, textAlign: 'center' }}>
          {this.state.error?.message || 'Wystąpił nieoczekiwany błąd aplikacji.'}
        </p>
        <button className="btn btn--primary" style={{ marginTop: 16 }} onClick={() => window.location.reload()}>
          Odśwież aplikację
        </button>
      </div>
    );
  }
}
