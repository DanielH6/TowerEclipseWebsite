import { Component, type ErrorInfo, type ReactNode } from "react";
import "./AppErrorBoundary.css";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Tower Eclipse UI error:", error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <main className="app-error-boundary" role="alert">
        <section>
          <p>INTERFACE ERROR</p>
          <h1>THIS PAGE HIT AN ERROR</h1>
          <span>{error.message || "An unexpected interface error occurred."}</span>
          <div>
            <button type="button" onClick={() => this.setState({ error: null })}>TRY AGAIN</button>
            <button type="button" onClick={() => window.location.reload()}>RELOAD PAGE</button>
            <a href="/">GO HOME</a>
          </div>
        </section>
      </main>
    );
  }
}
