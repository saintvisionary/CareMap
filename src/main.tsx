import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

/** If anything in the app throws while rendering, show what happened and a
 * way back instead of a blank screen. */
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("CareMap crashed:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-[#172033] p-6 font-sans text-white">
        <div className="max-w-sm rounded-[24px] border border-white/[0.08] bg-[#1b2336] p-6 text-center shadow-2xl">
          <img src="./logo.svg" alt="" className="mx-auto h-12 w-12 rounded-[13px]" />
          <h1 className="mt-4 text-[20px] font-semibold tracking-tight">Something went wrong</h1>
          <p className="mt-2 text-[14px] leading-relaxed text-white/60">CareMap hit an error. Reloading usually fixes it, and nothing you entered was sent anywhere.</p>
          <p className="mt-3 break-words rounded-xl bg-white/[0.06] px-3 py-2 text-left font-mono text-[12px] text-white/50">{error.message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 h-11 w-full rounded-full bg-white text-[15px] font-medium text-black transition-transform active:scale-[0.97]"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
