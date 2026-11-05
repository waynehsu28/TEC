'use client';
import { Component, type ReactNode } from 'react';

export default class ModuleBoundary extends Component<{ resetKey: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { console.error('Workspace screen could not render. The current navigation was preserved.'); }
  componentDidUpdate(previous: Readonly<{ resetKey: string; children: ReactNode }>) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }
  render() {
    if (this.state.failed) return <section className="panel" role="alert"><h2>這個畫面暫時無法顯示</h2><p>目前頁面已保留，不會自動切回營運總覽。請重試；若仍失敗，請保留錯誤訊息以便檢查。</p><button type="button" className="btn-secondary" onClick={() => this.setState({ failed: false })}>重試這個畫面</button></section>;
    return this.props.children;
  }
}
